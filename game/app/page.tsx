import { GameCanvas } from "@/components/GameCanvas";

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">AhaMed Doctor Game · Game layer</p>
          <h1>诊所运行时 PoC</h1>
        </div>
        <p>
          方向键或 WASD 移动，靠近患者后按 E / Enter 交互；移动端可使用屏幕控制。
        </p>
      </header>

      <GameCanvas />

      <footer className="page-footer">
        当前仅使用公开占位内容，病例隐藏事实、答案和评分规则不会进入浏览器。
      </footer>
    </main>
  );
}
