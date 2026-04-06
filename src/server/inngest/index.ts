import { extractDocument } from "./functions/extract-document";
import { caseAnalyze } from "./functions/case-analyze";
import { contractAnalyze } from "./functions/contract-analyze";
import { contractCompare } from "./functions/contract-compare";
import { contractGenerate } from "./functions/contract-generate";
import { creditReset } from "./functions/credit-reset";
import { autoDelete } from "./functions/auto-delete";
import { calendarEventSync } from "./functions/calendar-event-sync";

export const functions = [extractDocument, caseAnalyze, contractAnalyze, contractCompare, contractGenerate, creditReset, autoDelete, calendarEventSync];
