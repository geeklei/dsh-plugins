# dsh-file-manager

文件/目录管理插件，限制所有操作在 dsh 启动工作目录内：

- `/fs-list <相对路径>`：列出目录内容
- `/fs-mkdir <相对路径>`：创建目录
- `/fs-touch <相对路径>`：创建空文件
- `/fs-rm <相对路径>`：删除文件或空目录

插件通过 `cordis.patch.yml` 自动加入 dsh bundle，也可以直接加载 `index.js`。
