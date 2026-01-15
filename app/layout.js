import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "智慧政务服务搜索",
  description: "基于大模型的智能政务服务搜索Demo",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 核心修复：引入 Tailwind CSS CDN，无需配置文件即可直接渲染样式 */}
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
