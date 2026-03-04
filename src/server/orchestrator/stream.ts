import { log } from "../logger.ts";
import type { OrchestratorDeps } from "./deps.ts";

// --- Stream JSON types ---

export interface StreamContentBlock {
	type: string;
	id?: string;
	name?: string;
	text?: string;
	tool_use_id?: string;
	input?: Record<string, unknown>;
	content?: string | Array<{ type: string; text?: string }>;
}

export interface StreamMessage {
	type: string;
	subtype?: string;
	content_block?: StreamContentBlock;
	message?: {
		role?: string;
		content?: StreamContentBlock[];
	};
	result?: string;
}

/** Log a single content block (text, tool_use, or tool_result) as a task log. */
export function logContentBlock(block: StreamContentBlock, taskId: string, deps: OrchestratorDeps) {
	try {
		if (block.type === "text" && block.text) {
			const taskLog = deps.db.appendTaskLog(taskId, block.text.slice(0, 1000), "stdout");
			deps.broadcast({ type: "task_log", log: taskLog });
		} else if (block.type === "tool_use" && block.name) {
			const inputSummary = block.input ? ` ${JSON.stringify(block.input).slice(0, 200)}` : "";
			const taskLog = deps.db.appendTaskLog(taskId, `Tool: ${block.name}${inputSummary}`, "system");
			deps.broadcast({ type: "task_log", log: taskLog });
		} else if (block.type === "tool_result" && block.tool_use_id) {
			const outputText =
				typeof block.content === "string"
					? block.content
					: Array.isArray(block.content)
						? block.content
								.filter((c) => c.type === "text")
								.map((c) => c.text ?? "")
								.join("")
						: "";
			if (outputText) {
				const taskLog = deps.db.appendTaskLog(taskId, outputText.slice(0, 500), "stdout");
				deps.broadcast({ type: "task_log", log: taskLog });
			}
		}
	} catch (err) {
		log.error(
			"orchestrator",
			`Failed to log content block for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export interface StdoutLineResult {
	/** Collected assistant text block for fallback accumulation. */
	textBlock?: string;
	/** Result text if this is a result message. */
	resultText?: string;
}

/** Parse a single stdout JSON line, log content blocks, and extract text/result data. */
export function handleStdoutLine(trimmed: string, taskId: string, deps: OrchestratorDeps): StdoutLineResult {
	let msg: StreamMessage;
	try {
		msg = JSON.parse(trimmed);
	} catch {
		// Log non-JSON lines (CLI warnings, errors, etc.) instead of silently dropping
		try {
			const taskLog = deps.db.appendTaskLog(taskId, trimmed, "stdout");
			deps.broadcast({ type: "task_log", log: taskLog });
		} catch (err) {
			log.error(
				"orchestrator",
				`Failed to log non-JSON stdout for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		return {};
	}

	const result: StdoutLineResult = {};

	// Collect assistant text blocks for fallback accumulation
	if (msg.type === "content_block_start" && msg.content_block?.type === "text" && msg.content_block.text) {
		result.textBlock = msg.content_block.text;
	} else if (msg.message?.content) {
		const texts = msg.message.content.filter((b) => b.type === "text" && b.text).map((b) => b.text ?? "");
		if (texts.length > 0) result.textBlock = texts.join("\n");
	}

	// Handle content_block_start events (streaming deltas)
	if (msg.type === "content_block_start" && msg.content_block) {
		logContentBlock(msg.content_block, taskId, deps);
	}

	// Handle full message events (assistant/user turns with complete content)
	if (msg.message?.content) {
		for (const block of msg.message.content) {
			logContentBlock(block, taskId, deps);
		}
	}

	if ((msg.type === "result" || msg.subtype === "result") && msg.result) {
		result.resultText = msg.result;
	}

	return result;
}

/** Read stdout as JSONL, extract text/tool events, return final result text. */
export async function processStdout(
	stream: ReadableStream<Uint8Array>,
	taskId: string,
	deps: OrchestratorDeps,
): Promise<string | undefined> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let resultText: string | undefined;
	const textBlocks: string[] = [];
	let lineCount = 0;
	let chunkCount = 0;

	log.info("orchestrator", `[task=${taskId}] stdout reader started`);

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				log.info("orchestrator", `[task=${taskId}] stdout EOF after ${chunkCount} chunks, ${lineCount} lines`);
				break;
			}

			chunkCount++;
			if (chunkCount === 1) {
				log.info("orchestrator", `[task=${taskId}] stdout first chunk received (${value.byteLength} bytes)`);
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				lineCount++;
				const { textBlock, resultText: result } = handleStdoutLine(trimmed, taskId, deps);
				if (textBlock) textBlocks.push(textBlock);
				if (result !== undefined) {
					resultText = result;
				}
			}
		}

		// Flush remaining buffer after EOF
		const remaining = buffer.trim();
		if (remaining) {
			lineCount++;
			const { textBlock, resultText: result } = handleStdoutLine(remaining, taskId, deps);
			if (textBlock) textBlocks.push(textBlock);
			if (result !== undefined) {
				resultText = result;
			}
		}
	} finally {
		reader.releaseLock();
	}

	// Prefer explicit result; fall back to joining all assistant text blocks
	return resultText ?? (textBlocks.length > 0 ? textBlocks.join("\n") : undefined);
}

/** Stream stderr lines as stderr task logs. */
export async function processStderr(
	stream: ReadableStream<Uint8Array>,
	taskId: string,
	deps: OrchestratorDeps,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let lineCount = 0;

	log.info("orchestrator", `[task=${taskId}] stderr reader started`);

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				log.info("orchestrator", `[task=${taskId}] stderr EOF after ${lineCount} lines`);
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				lineCount++;
				if (lineCount <= 3) {
					log.info("orchestrator", `[task=${taskId}] stderr[${lineCount}]: ${trimmed.slice(0, 200)}`);
				}
				try {
					const taskLog = deps.db.appendTaskLog(taskId, trimmed, "stderr");
					deps.broadcast({ type: "task_log", log: taskLog });
				} catch (err) {
					log.error(
						"orchestrator",
						`Failed to log stderr for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		}

		// Flush remaining buffer after EOF
		const remaining = buffer.trim();
		if (remaining) {
			lineCount++;
			log.info("orchestrator", `[task=${taskId}] stderr flush: ${remaining.slice(0, 200)}`);
			try {
				const taskLog = deps.db.appendTaskLog(taskId, remaining, "stderr");
				deps.broadcast({ type: "task_log", log: taskLog });
			} catch (err) {
				log.error(
					"orchestrator",
					`Failed to log stderr flush for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	} finally {
		reader.releaseLock();
	}
}
