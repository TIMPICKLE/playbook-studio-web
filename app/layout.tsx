import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playbook Studio · 共享战术工作台",
  description: "橄榄球战术编辑、云端保存、团队协作和成员权限管理。",
  icons: {
    icon: "/editor/icon.svg",
    shortcut: "/editor/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
