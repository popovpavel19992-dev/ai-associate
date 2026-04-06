import { extractDocument } from "./functions/extract-document";
import { caseAnalyze } from "./functions/case-analyze";
import { contractAnalyze } from "./functions/contract-analyze";
import { contractCompare } from "./functions/contract-compare";
import { contractGenerate } from "./functions/contract-generate";
import { creditReset } from "./functions/credit-reset";
import { autoDelete } from "./functions/auto-delete";
import { calendarEventSync } from "./functions/calendar-event-sync";
import { calendarSweep } from "./functions/calendar-sweep";
import { calendarConnectionInit } from "./functions/calendar-connection-init";
import { calendarConnectionCleanup } from "./functions/calendar-connection-cleanup";

export const functions = [extractDocument, caseAnalyze, contractAnalyze, contractCompare, contractGenerate, creditReset, autoDelete, calendarEventSync, calendarSweep, calendarConnectionInit, calendarConnectionCleanup];
