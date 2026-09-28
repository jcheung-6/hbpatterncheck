export type AppErrorCode =
  | "missing_key"
  | "rate_limit"
  | "no_image_support"
  | "unauthorized"
  | "bad_image"
  | "file_too_large"
  | "unreadable"
  | "identifiers"
  | "provider"
  | "bad_request";

export const ERRORS: Record<AppErrorCode, { zh: string; en: string }> = {
  missing_key: {
    zh: "未設定 OPENROUTER_API_KEY，所以讀唔到圖像。請喺伺服器 .env.local 設定金鑰，或者貼上列印報表嘅峰表，又或者打開示範個案（示範用內置數值，不會假裝已經讀圖）。",
    en: "OPENROUTER_API_KEY is not set, so images cannot be read. Add it to .env.local, paste the printed peak table, or open a demo case. Demos use built-in figures and do not pretend the image was read.",
  },
  rate_limit: {
    zh: "OpenRouter 回覆速率限制（429）。請稍後再試，或喺 .env.local 改 OPENROUTER_MODEL。",
    en: "OpenRouter rate-limited this request (429). Wait and retry, or change OPENROUTER_MODEL in .env.local.",
  },
  no_image_support: {
    zh: "而家嘅模型似乎不支援圖像輸入。請將 OPENROUTER_VISION_MODEL 改成支援 vision 嘅模型，例如 openai/gpt-4o 或 google/gemini-2.5-flash。",
    en: "The selected model does not appear to accept images. Set OPENROUTER_VISION_MODEL to a vision-capable model such as openai/gpt-4o or google/gemini-2.5-flash.",
  },
  unauthorized: {
    zh: "OpenRouter 拒絕咗金鑰（401／403）。請檢查 OPENROUTER_API_KEY。",
    en: "OpenRouter rejected the API key (401/403). Check OPENROUTER_API_KEY.",
  },
  bad_image: {
    zh: "圖像無法處理。請上傳 4MB 以下嘅 PNG 或 JPEG，並裁走病人身份。",
    en: "The image could not be processed. Upload a PNG or JPEG under 4 MB and crop out identifiers.",
  },
  file_too_large: {
    zh: "檔案超過 4MB，已拒絕。請裁剪或匯出較細嘅螢幕截圖。",
    en: "The file is over 4 MB and was rejected. Crop or export a smaller screenshot.",
  },
  unreadable: {
    zh: "圖像未能可靠讀出峰。請上傳更清晰嘅裁片，或貼上報表上嘅數值表。系統不會估造峰。",
    en: "The image could not be read reliably. Send a clearer crop or paste the numeric table from the printout. Peaks are not invented.",
  },
  identifiers: {
    zh: "呢段字好像有病人姓名、身份證號或住院號。請刪除身份資料後再傳送。本程式不儲存病人身份。",
    en: "This text looks like it contains a patient name, identity number, or hospital number. Remove identifiers and send again. This app does not store patient identifiers.",
  },
  provider: {
    zh: "呼叫 OpenRouter 失敗。請檢查網絡、金鑰同模型名稱。峰沒有被估造。",
    en: "The OpenRouter call failed. Check the network, key, and model name. Peaks were not invented.",
  },
  bad_request: {
    zh: "請上傳圖像、貼上峰表，或選擇一個示範個案。",
    en: "Upload an image, paste a peak table, or choose a demo case.",
  },
};

export function errorBody(code: AppErrorCode): { ok: false; error: { code: string; zh: string; en: string } } {
  return { ok: false, error: { code, ...ERRORS[code] } };
}
