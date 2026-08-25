import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AhaMed Doctor Game",
  description: "AhaMed 模拟医生小游戏",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

