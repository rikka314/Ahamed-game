import { GameCanvas } from "@/components/GameCanvas";

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">AhaMed Doctor Game · S2 graybox</p>
          <h1 aria-label="今天，诊所开始接诊">
            <span>今天，</span>
            <span>诊所开始接诊</span>
          </h1>
        </div>
        <p>
          从黑屏淡入、打开电脑、形成队列到连续叫入两名患者。方向键 / WASD
          移动，E / Enter 交互；移动端请使用横屏与触控方向键。
        </p>
      </header>

      <GameCanvas />

      <footer className="page-footer">
        S2 技术灰盒 · 当前素材均为 PLACEHOLDER，不代表最终美术。病例隐藏事实、答案、评分细则
        与模型密钥不会进入浏览器。
      </footer>
    </main>
  );
}
