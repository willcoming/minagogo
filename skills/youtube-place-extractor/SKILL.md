---
name: youtube-place-extractor
description: 從 YouTube 影片抓取餐廳、咖啡廳、景點或店家清單並整理成 Markdown。當使用者提供 YouTube 連結，要求取得店名、地圖連結、Google Maps 評價、影片心得/YouTube 評價、時間戳、頻道名稱，或要求「抓店家」、「做成 MD」、「用 Gemini 分析影片」時使用。
---

# YouTube 地點抓取

## 目標

把 YouTube 影片中的店家或地點整理成可保存的 Markdown 表格，至少包含店名、地圖連結、Google Maps 評價、YouTube 評價、影片連結與頻道名稱。

## 工作流程

1. 先確認影片頁資訊：標題、頻道名稱、影片 URL。
2. 展開 YouTube 描述欄，優先從章節與描述中的地圖連結抓店名、時間戳和 Google Maps 短連結。
3. 開啟「顯示轉錄稿」，用章節切分每間店的字幕內容，萃取創作者在影片中的心得，寫成「YouTube 評價」。
4. 逐一開啟 Google Maps 連結，抓 Google 評分與評論數。
5. 預設使用 Gemini 網頁版做最後整理：開啟 `https://gemini.google.com/app`，把影片 URL、店名、YouTube 描述欄抓到的地圖連結、Google Maps 查到的評分、轉錄稿片段一起貼給 Gemini，請它只做繁體中文摘要/翻譯與表格整理。不要讓 Gemini 自行補地圖連結或評分；Gemini 直接讀影片時可能產生錯誤短連結，必須以 YouTube 描述欄與 Google Maps 實查結果為準。
6. 用 `scripts/make_markdown.py` 產出 Markdown，或手動照同一欄位格式寫入檔案。

## Browser 抓取要點

使用 browser skill 或可用的瀏覽器工具時：

- YouTube 描述欄按鈕常見文字是 `...更多內容` 或 `顯示完整資訊`。
- 轉錄稿區塊通常在展開描述後出現，按鈕文字是 `顯示轉錄稿`。
- Google Maps 頁面常見可抓訊號：
  - heading level 1 是店名。
  - `x.x 顆星` 是評分。
  - `n 則評論` 或 `n 篇評論` 是評論數。
- 評分與評論數會變動，在 Markdown 加上查核日期。

## Gemini 網頁版流程

預設流程改為使用 Gemini 網頁版，但 Gemini 的角色是「摘要、翻譯、排版」，不是店名、地圖連結或評分的權威來源。

1. 用 browser 開啟 `https://gemini.google.com/app`。
2. 單支影片可以先貼 YouTube URL，請 Gemini 嘗試分析影片內容與店家心得；但輸出的店名、地圖連結、評分都要再與 YouTube 描述欄/Google Maps 實查資料比對。
3. 批量頻道不要讓 Gemini 自行逐支搜尋。先用瀏覽器或 YouTube 資料抓出結構化資料包，再分批貼給 Gemini：
   - 影片標題、影片 URL、頻道名稱。
   - 描述欄店名、原始地圖連結、時間戳。
   - Google Maps 已查得的評分與評論數。
   - 轉錄稿或描述欄中的菜色、價格、心得、二刷指數。
4. 貼給 Gemini 時明確要求：「只整理/翻譯/摘要，不要新增店家，不要改地圖連結，不要補 Google 評分，不確定就保留原文或標示未取得」。
5. 從 Gemini 回覆取回「YouTube 評價」欄與表格文字後，再用本地已驗證的店名、地圖連結、Google Maps 評價覆蓋一次。
6. 最終 Markdown 只能使用已驗證資料；Gemini 的作用是整理與翻譯，不是權威資料來源。

### Gemini 貼上提示範本

```text
請把以下 YouTube 影片店家資料整理成繁體中文 Markdown 表格。

規則：
- 只能使用我提供的店名、地圖連結、Google Maps 評價、影片連結。
- 不要新增店家，不要刪除店家，不要自行猜測或補地圖連結。
- Google Maps 評價若是「未取得」就保留「Google Maps 未取得」。
- 「YouTube 評價」請根據我提供的描述欄、轉錄稿或菜色心得，濃縮成 1-2 句繁體中文。
- 若沒有明確心得，寫「影片僅列出店家，未提供明確心得。」
- 輸出欄位固定為：
  店名 | 地圖連結 | Google Maps 評價 | YouTube 評價 | 影片連結 | 頻道名稱

資料：
...
```

### 批量頻道節奏

- 每批貼給 Gemini 5-15 支影片，避免回覆被截斷。
- 每批回覆先保存成暫存 Markdown 或 JSON，再進行下一批。
- 如果 Gemini 產生不存在的短網址、錯誤評分或額外店家，丟棄該欄位並回到本地資料。
- 大頻道可以先產出「描述欄驗證版」Markdown，再用 Gemini 逐批補強 YouTube 評價欄。

## YouTube 評價寫法

「YouTube 評價」不是 YouTube 留言，也不是影片按讚數；它是從影片字幕/轉錄稿整理出的創作者心得。

寫法保持簡短：

- 摘 1-3 句重點。
- 包含創作者明確提到的特色、餐點、優缺點或推薦情境。
- 可以改寫摘要，不要長篇引用字幕。
- 沒有明確心得時寫 `影片僅列出店家，未提供明確心得。`

## Markdown 欄位

預設欄位：

```markdown
| 店名 | 地圖連結 | Google Maps 評價 | YouTube 評價 | 影片連結 | 頻道名稱 |
| --- | --- | --- | --- | --- | --- |
```

影片連結用時間戳，例如：

```markdown
[02:11](https://www.youtube.com/watch?v=VIDEO_ID&t=131s)
```

## Script

當已經整理出結構化 JSON 時，在本專案內使用：

```bash
python3 skills/youtube-place-extractor/scripts/make_markdown.py input.json output.md
```

JSON 格式：

```json
{
  "title": "影片標題",
  "video_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "channel": "頻道名稱",
  "checked_date": "2026-05-20",
  "places": [
    {
      "name": "店名",
      "map_url": "https://maps.app.goo.gl/...",
      "google_rating": "Google Maps 4.1（1,021 則評論）",
      "youtube_review": "影片心得摘要",
      "time": "02:11"
    }
  ]
}
```

## 輸出檔名

若使用者未指定檔名，用影片主題加影片 ID，例如：

```text
tokyo_station_cafes_k1rc9Sqk29k.md
```
