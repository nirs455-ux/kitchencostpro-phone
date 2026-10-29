// הגדרות ששייכות למכשיר ולא עוברות בגיבוי (ידני או ענן) ולא נדרסות בשחזור: מפתח Gemini אישי, חיבור הענן, קוד נעילת עובד ותפקיד המכשיר.
export const DEVICE_ONLY_KEYS = new Set(["gemini_api_key", "google_client_id", "staff_pin_hash", "staff_recovery_hash", "role"]);
export const isDeviceOnlySetting = (k) => DEVICE_ONLY_KEYS.has(String(k)) || String(k).startsWith("cloud_");
