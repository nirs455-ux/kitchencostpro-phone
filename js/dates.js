// תאריכים לפי השעון המקומי (toISOString נותן UTC: בישראל בין חצות לשתיים-שלוש בלילה יוצא היום הקודם)
const pad = (n) => String(n).padStart(2, "0");
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localMonth = (d = new Date()) => localDate(d).slice(0, 7);
