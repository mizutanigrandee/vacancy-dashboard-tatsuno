import pandas as pd
import json

# ファイルパス
EXCEL_PATH = "event_data.xlsx"
JSON_PATH = "event_data.json"

def main():
    df = pd.read_excel(EXCEL_PATH).dropna(subset=["date", "icon", "name"])
    data = {}
    for _, row in df.iterrows():
        date = pd.to_datetime(row["date"]).date().isoformat()
        icon = str(row["icon"])
        name = str(row["name"])
        data.setdefault(date, []).append({"icon": icon, "name": name})
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
