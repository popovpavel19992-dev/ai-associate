import { extractDocument } from "./functions/extract-document";
import { caseAnalyze } from "./functions/case-analyze";
import { creditReset } from "./functions/credit-reset";
import { autoDelete } from "./functions/auto-delete";

export const functions = [extractDocument, caseAnalyze, creditReset, autoDelete];
