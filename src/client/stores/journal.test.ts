import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { JournalEntry } from "../../shared/types.ts";
import { sendRequestJournal } from "./commands.ts";
import { useConnectionStore } from "./connection.ts";
import { useJournalStore } from "./journal.ts";
import { handleServerMessage } from "./messageHandler.ts";

describe("journal store", () => {
	const entry1: JournalEntry = {
		id: "j1",
		projectId: "p1",
		content: "Discovered auth module uses deprecated API",
		tier: "recent",
		createdAt: "2026-03-10T10:00:00.000Z",
	};
	const entry2: JournalEntry = {
		id: "j2",
		projectId: "p1",
		content: "Switched from bcrypt to argon2",
		tier: "summary",
		createdAt: "2026-03-09T10:00:00.000Z",
	};

	beforeEach(() => {
		useJournalStore.setState({ entries: {} });
	});

	test("setEntries stores entries by project", () => {
		useJournalStore.getState().setEntries("p1", [entry1, entry2]);
		const stored = useJournalStore.getState().entries.p1;
		expect(stored).toHaveLength(2);
		expect(stored?.[0]?.id).toBe("j1");
	});

	test("setEntries replaces previous entries for same project", () => {
		useJournalStore.getState().setEntries("p1", [entry1, entry2]);
		useJournalStore.getState().setEntries("p1", [entry1]);
		expect(useJournalStore.getState().entries.p1).toHaveLength(1);
	});

	test("setEntries keeps entries for other projects", () => {
		useJournalStore.getState().setEntries("p1", [entry1]);
		useJournalStore.getState().setEntries("p2", [entry2]);
		expect(useJournalStore.getState().entries.p1).toHaveLength(1);
		expect(useJournalStore.getState().entries.p2).toHaveLength(1);
	});
});

describe("journal message handler", () => {
	beforeEach(() => {
		useJournalStore.setState({ entries: {} });
	});

	test("journal_entries message populates store", () => {
		const entry: JournalEntry = {
			id: "j1",
			projectId: "p1",
			content: "Test entry",
			tier: "recent",
			createdAt: "2026-03-10T10:00:00.000Z",
		};
		handleServerMessage({ type: "journal_entries", projectId: "p1", entries: [entry] });

		const stored = useJournalStore.getState().entries.p1;
		expect(stored).toHaveLength(1);
		expect(stored?.[0]?.content).toBe("Test entry");
	});
});

describe("journal commands", () => {
	const sendMock = mock<(data: string) => boolean>(() => true);
	const originalSend = useConnectionStore.getState().send;

	beforeEach(() => {
		sendMock.mockClear();
		useConnectionStore.setState({ send: sendMock } as never);
	});

	afterEach(() => {
		useConnectionStore.setState({ send: originalSend } as never);
	});

	test("sendRequestJournal sends get_journal message", () => {
		sendRequestJournal("p1");
		expect(sendMock).toHaveBeenCalledTimes(1);
		const msg = JSON.parse(sendMock.mock.calls[0]![0]);
		expect(msg).toEqual({ type: "get_journal", projectId: "p1" });
	});

	test("sendRequestJournal includes tier and limit when provided", () => {
		sendRequestJournal("p1", "summary", 5);
		const msg = JSON.parse(sendMock.mock.calls[0]![0]);
		expect(msg).toEqual({ type: "get_journal", projectId: "p1", tier: "summary", limit: 5 });
	});
});
