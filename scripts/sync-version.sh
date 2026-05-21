#!/bin/bash

# 同步版本號指令碼
# 從 tauri.conf.json 讀取版本號並更新 iOS Info.plist

# 獲取當前版本號
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

echo "同步版本號: $VERSION"

# 更新 iOS Info.plist
PLIST_PATH="src-tauri/gen/apple/note-gen_iOS/Info.plist"

if [ -f "$PLIST_PATH" ]; then
    # 更新版本號 - 使用更精確的匹配模式
    sed -i '' '/CFBundleShortVersionString/,/<string>/s/<string>.*<\/string>/<string>'$VERSION'<\/string>/' "$PLIST_PATH"
    sed -i '' '/CFBundleVersion/,/<string>/s/<string>.*<\/string>/<string>'$VERSION'<\/string>/' "$PLIST_PATH"
    
    echo "iOS 版本號已更新為: $VERSION"
else
    echo "Info.plist 檔案不存在，請先執行構建命令"
fi
