# 从本仓库安装

本仓库是 [pan17/dsh-wechat](https://github.com/pan17/dsh-wechat) 的独立副本（MIT）。
仓库内已提交构建产物 `dist/`，因此可以直接从 Git 安装，不需要在安装时编译。

## 安装到 DSH

```bash
dsh plugin --profile desktop add "github:zhouhang/dsh-wechat"
```

指定分支：

```bash
dsh plugin --profile desktop add "github:zhouhang/dsh-wechat#main"
```

安装后完全退出 DSH 再重新打开，然后进入 **设置 → WeChat** 扫码登录。

## 关于「搜索 dsh-wechat」

DSH 的插件搜索走 npm registry。`dsh-wechat` 这个 npm 包名属于原作者，
所以搜索 `dsh-wechat` 命中的是 npm 上的原包，不会指向本仓库。
要从本仓库安装，请使用上面的 Git 地址；或者在 npm 上发布一个自己的包名。
