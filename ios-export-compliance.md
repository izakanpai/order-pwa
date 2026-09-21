# iOS暗号輸出申告の判断記録

最終確認日: 2026-09-16

## 結論

現行iOSアプリは独自暗号、非標準暗号、またはApple OS外で提供される暗号化アルゴリズムを実装していない。`Info.plist`の`ITSAppUsesNonExemptEncryption`を`false`とし、非免除暗号を使用しないことを宣言する。

この設定はAppleの審査判断や法的助言を代替しない。依存ライブラリ、通信、認証、保存方式を変更した場合は、リリース前に再監査する。

## 現行実装の確認結果

| 対象 | 実装 | 判断 |
|---|---|---|
| API通信 | Capacitor/WKWebViewとAppleのURLSessionを通じたHTTPS | Apple OS提供の暗号化 |
| 認証情報保存 | `@aparajita/capacitor-secure-storage`からApple Keychainを使用 | Apple OS提供のセキュア保存 |
| Capacitor App UUID | CommonCryptoのSHA-256 | 一方向ハッシュであり、アプリ独自の暗号化機能ではない |
| RevenueCat | iOS SDK経由の購入・購読状態通信 | アプリ側に独自暗号実装なし |
| アプリ固有コード | AES、ChaCha、RSA等の暗号化／復号実装なし | 非免除暗号を確認せず |

Worker側のHMAC-SHA256、パスワードハッシュ、署名検証はCloudflare上で動作し、配布するiOSアプリのバイナリには含まれない。

## Apple公式基準

- [Complying with Encryption Export Regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations): OS組み込みの暗号化だけを使う場合など、輸出書類が免除される暗号だけを使うアプリは`ITSAppUsesNonExemptEncryption=NO`とする。
- [Export compliance documentation for encryption](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption): Apple OSが提供する暗号化だけを使うアプリはApp Store Connectへの書類提出不要としている。
- [Overview of export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance): 最終的な輸出規制判断と申告の責任は配布者にある。

## 再監査が必要になる変更

- アプリ内へ独自または第三者の暗号化／復号ライブラリを追加
- VPN、エンドツーエンド暗号化メッセージ、独自鍵交換、暗号ウォレット等を追加
- Keychain以外の独自暗号化ストレージへ変更
- RevenueCat、Capacitor、secure-storage等の依存更新で暗号実装が変化
- 配布地域または輸出規制上の前提が変化

App Store Connectへ初回buildを登録した際は、buildが`Missing Compliance`にならないことと、管理画面の回答がこの記録と一致することを確認する。
