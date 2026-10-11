/**
 * What a shipment popup shows when the server refuses a save. The server's own
 * reason is the useful one ("לא ניתן לערוך משלוח שנשלח"), but several routes
 * still answer in English ("Missing required fields") — those fall back to a
 * Hebrew sentence that says what happened and what to do.
 */
const HEBREW = /[֐-׿]/;

export async function serverErrorMessage(res: Response, fallback: string): Promise<string> {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
    return typeof message === "string" && HEBREW.test(message) ? message : fallback;
}

export const NETWORK_ERROR = "אין תקשורת עם השרת. בדוק את החיבור ונסה שוב — הפרטים שהזנת נשמרו בטופס.";
