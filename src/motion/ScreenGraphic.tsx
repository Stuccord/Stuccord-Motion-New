// The app screen graphic, in every look: a phone (tall videos) or browser
// window (wide and square ones) floats in at an angle with a soft shadow, a
// cursor glides over and clicks, then the camera eases in toward the click.
// The screen shows a picture (an upload, or a captured web page that slowly
// scrolls) or draws one from the graphic's words: a chat, a dashboard or a
// sales page. Apps are drawn light, like real ones, whatever the look; the
// look sets the page around the device (its `background` and `ink`).

import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { ArrowUp, Check, Lock, Sparkles } from "lucide-react";
import { SANS, type MotionTheme } from "@/motion/theme";
import { screenBeats } from "@/motion/beats";
import type { PlacedGraphic } from "@/motion/timing";
import {
  ImagesContext,
  clamp01,
  easeOut,
  exitOpacity,
  inkAccent,
  rand,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

const APP_BG = "#FFFFFF";
const APP_INK = "#0F172A";
const APP_SOFT = "#64748B";
const APP_LINE = "#E2E8F0";
const APP_FILL = "#F1F5F9";

const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** The host name to show in a browser bar ("stripe.com" from "https://www.stripe.com/x"). */
function screenHost(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return raw.slice(0, 40);
  }
}

/** Where the cursor clicks, as a fraction of the screen (chat: send; page: its button...). */
const TARGET: Record<string, { x: number; y: number }> = {
  chat: { x: 0.88, y: 0.9 },
  dashboard: { x: 0.3, y: 0.26 },
  page: { x: 0.5, y: 0.62 },
  picture: { x: 0.5, y: 0.34 },
};

/** Where the camera eases in after the click: the part worth reading (chat: the reply...). */
const FOCUS: Record<string, { x: number; y: number }> = {
  chat: { x: 0.5, y: 0.42 },
  dashboard: { x: 0.4, y: 0.3 },
  page: { x: 0.5, y: 0.5 },
  picture: { x: 0.5, y: 0.3 },
};

export function ScreenGraphic({
  g,
  theme,
  background,
  ink,
}: {
  g: PlacedGraphic;
  theme: MotionTheme;
  /** The page around the device (a CSS background). */
  background: string;
  /** Words on that page. */
  ink: string;
}) {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const images = React.useContext(ImagesContext);
  const length = g.to - g.from;
  const s = g.screen ?? { kind: "page" as const, device: "auto" as const, url: "" };
  const phone = s.device === "phone" || (s.device === "auto" && portrait);
  const b = screenBeats(length);
  const accent = inkAccent(theme);

  // The device's size: a phone 72% of the height (tall videos); a browser
  // 72% of the width (wide), or nearly all of it (tall or square).
  const dw = phone
    ? Math.min(height * 0.7 * (9 / 19.5), width * 0.78)
    : width * (portrait ? 0.9 : width === height ? 0.84 : 0.7);
  const dh = phone ? dw * (19.5 / 9) : dw * (10 / 16);
  const bar = phone ? 0 : dh * 0.075;
  const target = TARGET[s.kind] ?? TARGET.page;
  const focus = FOCUS[s.kind] ?? FOCUS.page;

  // It floats in tilted, settles at a slight angle with a gentle bob, then
  // flattens and moves closer as the camera eases in on the part to read.
  const enter = easeOut(frame / 18);
  const zoom = easeInOut((frame - b.zoomFrom) / b.zoomFrames);
  const rx = (1 - enter) * 26 + 7 * (1 - zoom);
  const ry = (1 - enter) * -20 - 9 * (1 - zoom);
  const bob = Math.sin(frame / 22) * unit * 0.5 * (1 - zoom);
  const scale = (0.86 + 0.14 * enter) * (1 + 0.35 * zoom);
  // Moves that part toward the middle as it zooms.
  const tx = (0.5 - focus.x) * dw * 0.35 * zoom;
  const ty = (0.5 - focus.y) * (dh - bar) * 0.35 * zoom;

  // The cursor: from the lower right to the click, pressing in on the click.
  const glide = easeInOut((frame - b.cursorFrom) / 12);
  const cx = dw * (1.05 + (target.x - 1.05) * glide);
  const cy = bar + (dh - bar) * (1.08 + (target.y - 1.08) * glide);
  const pressing = frame >= b.clickAt && frame < b.clickAt + 6;
  const clicked = frame >= b.clickAt;

  const pictureUrl = g.scenes?.[0]?.image ? images[g.scenes[0].image] : undefined;
  const content = (() => {
    switch (s.kind) {
      case "picture":
        return <PictureScreen url={pictureUrl} frame={frame} length={length} />;
      case "chat":
        return (
          <ChatScreen
            g={g}
            frame={frame}
            unit={unit}
            phone={phone}
            accent={accent}
            clickAt={b.clickAt}
          />
        );
      case "dashboard":
        return <DashboardScreen g={g} frame={frame} unit={unit} phone={phone} accent={accent} />;
      default:
        return (
          <PageScreen
            g={g}
            frame={frame}
            unit={unit}
            phone={phone}
            accent={accent}
            host={screenHost(s.url)}
            clicked={clicked}
          />
        );
    }
  })();

  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(easeOut(frame / 8), exitOpacity(frame, length)),
        background,
        color: ink,
        fontFamily: SANS,
        overflow: "hidden",
        perspective: width * 1.6,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: (width - dw) / 2,
          top: (height - dh) / 2 + (1 - enter) * height * 0.18 + bob,
          width: dw,
          height: dh,
          transformStyle: "preserve-3d",
          transform: `translate(${tx}px, ${ty}px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${scale})`,
          transformOrigin: `${focus.x * 100}% ${((bar + (dh - bar) * focus.y) / dh) * 100}%`,
        }}
      >
        {/* The soft shadow under it. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: phone ? dw * 0.13 : unit * 1.6,
            boxShadow: `0 ${unit * 5}px ${unit * 12}px rgba(15, 23, 42, 0.35), 0 ${unit}px ${unit * 3}px rgba(15, 23, 42, 0.2)`,
          }}
        />
        {phone ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: dw * 0.13,
              background: "#0B0B0D",
              padding: dw * 0.028,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                borderRadius: dw * 0.105,
                overflow: "hidden",
                background: APP_BG,
              }}
            >
              {content}
              {/* The island at the top. */}
              <div
                style={{
                  position: "absolute",
                  top: dw * 0.03,
                  left: "50%",
                  width: dw * 0.3,
                  height: dw * 0.075,
                  marginLeft: -dw * 0.15,
                  borderRadius: dw,
                  background: "#0B0B0D",
                }}
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: unit * 1.6,
              overflow: "hidden",
              background: APP_BG,
              border: `1px solid ${APP_LINE}`,
            }}
          >
            <BrowserBar height={bar} host={screenHost(s.url)} unit={unit} />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: bar,
                bottom: 0,
                overflow: "hidden",
              }}
            >
              {content}
            </div>
          </div>
        )}
        {/* The cursor, over the screen. */}
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            opacity: clamp01((frame - b.cursorFrom + 4) / 6),
            transform: `translateZ(${unit * 2}px) scale(${pressing ? 0.82 : 1})`,
            transformOrigin: "0 0",
          }}
        >
          {pressing && (
            <div
              style={{
                position: "absolute",
                left: -unit * 2.2,
                top: -unit * 2.2,
                width: unit * 4.4,
                height: unit * 4.4,
                borderRadius: "50%",
                background: "rgba(15, 23, 42, 0.18)",
              }}
            />
          )}
          <svg
            width={unit * 4.2}
            height={unit * 4.2}
            viewBox="0 0 24 24"
            style={{ display: "block" }}
          >
            <path
              d="M4 2.5 L4 19 L8.6 14.8 L11.6 21.5 L14.4 20.3 L11.5 13.7 L17.8 13.7 Z"
              fill="#FFFFFF"
              stroke="#0F172A"
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function BrowserBar({ height, host, unit }: { height: number; host: string; unit: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height,
        background: APP_FILL,
        borderBottom: `1px solid ${APP_LINE}`,
        display: "flex",
        alignItems: "center",
        gap: height * 0.18,
        padding: `0 ${height * 0.4}px`,
        boxSizing: "border-box",
      }}
    >
      {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
        <span
          key={c}
          style={{
            width: height * 0.26,
            height: height * 0.26,
            borderRadius: "50%",
            background: c,
          }}
        />
      ))}
      <div
        style={{
          flex: 1,
          margin: `0 ${height * 0.6}px`,
          height: height * 0.56,
          borderRadius: height,
          background: APP_BG,
          border: `1px solid ${APP_LINE}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: height * 0.12,
          fontSize: height * 0.3,
          color: APP_SOFT,
        }}
      >
        <Lock size={height * 0.26} strokeWidth={2.4} />
        {host || "app"}
      </div>
      <span style={{ width: unit * 2 }} />
    </div>
  );
}

/** A picture filling the screen from the top, scrolling slowly when it's tall. */
function PictureScreen({
  url,
  frame,
  length,
}: {
  url: string | undefined;
  frame: number;
  length: number;
}) {
  if (!url) {
    return (
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${APP_FILL}, ${APP_LINE})` }} />
    );
  }
  const scroll = easeInOut(frame / Math.max(1, length)) * 30;
  return (
    <Img
      src={url}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: `50% ${scroll}%`,
        display: "block",
      }}
    />
  );
}

/** A chat with an AI: the question typed in, then the reply's lines one by one. */
function ChatScreen({
  g,
  frame,
  unit,
  phone,
  accent,
  clickAt,
}: {
  g: PlacedGraphic;
  frame: number;
  unit: number;
  phone: boolean;
  accent: string;
  clickAt: number;
}) {
  const size = unit * (phone ? 2.9 : 2.1);
  const typed = g.text.slice(
    0,
    Math.floor(g.text.length * clamp01((frame - 6) / Math.max(1, clickAt - 10))),
  );
  const sent = frame >= clickAt;
  const replyFrom = clickAt + 10;
  return (
    <AbsoluteFill
      style={{
        background: APP_BG,
        color: APP_INK,
        fontSize: size,
        padding: size * 1.4,
        paddingTop: phone ? size * 4 : size * 1.4,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: size * 0.9,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: size * 0.4,
          fontWeight: 600,
          paddingBottom: size * 0.6,
          borderBottom: `1px solid ${APP_LINE}`,
        }}
      >
        <Sparkles size={size * 1.1} color={accent} />
        Assistant
      </div>
      {sent && (
        <div
          style={{
            alignSelf: "flex-end",
            maxWidth: "80%",
            background: APP_FILL,
            borderRadius: size,
            padding: `${size * 0.6}px ${size * 0.9}px`,
            lineHeight: 1.35,
          }}
        >
          {g.text}
        </div>
      )}
      {sent && frame < replyFrom && (
        <div style={{ display: "flex", gap: size * 0.3, padding: size * 0.4 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: size * 0.45,
                height: size * 0.45,
                borderRadius: "50%",
                background: APP_SOFT,
                opacity: 0.35 + 0.65 * ((Math.floor(frame / 4) + i) % 3 === 0 ? 1 : 0),
              }}
            />
          ))}
        </div>
      )}
      {frame >= replyFrom &&
        g.items.map((line, i) => {
          const p = easeOut((frame - replyFrom - i * 8) / 8);
          return (
            <div
              key={i}
              style={{
                lineHeight: 1.4,
                opacity: p,
                transform: `translateY(${(1 - p) * size * 0.6}px)`,
              }}
            >
              {line}
            </div>
          );
        })}
      <div style={{ flex: 1 }} />
      {/* The message box, with the question being typed and the send button. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: size * 0.6,
          border: `1px solid ${APP_LINE}`,
          borderRadius: size * 1.4,
          padding: `${size * 0.5}px ${size * 0.5}px ${size * 0.5}px ${size}px`,
          color: sent || !typed ? APP_SOFT : APP_INK,
        }}
      >
        <span
          style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {sent ? "Message" : typed || "Message"}
        </span>
        <span
          style={{
            width: size * 1.8,
            height: size * 1.8,
            borderRadius: "50%",
            background: typed ? accent : APP_LINE,
            display: "grid",
            placeItems: "center",
          }}
        >
          <ArrowUp size={size * 1.1} color="#FFFFFF" strokeWidth={2.6} />
        </span>
      </div>
    </AbsoluteFill>
  );
}

/** A dashboard: its title, a headline number counting up, a chart and rows. */
function DashboardScreen({
  g,
  frame,
  unit,
  phone,
  accent,
}: {
  g: PlacedGraphic;
  frame: number;
  unit: number;
  phone: boolean;
  accent: string;
}) {
  const size = unit * (phone ? 2.6 : 1.9);
  const n = g.number;
  const shown = n ? n.value * easeOut((frame - 10) / 26) : 0;
  const decimals =
    n && !Number.isInteger(n.value) ? Math.min(2, String(n.value).split(".")[1]?.length ?? 0) : 0;
  const value = n
    ? `${n.prefix}${shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${n.suffix}`
    : null;
  // A steady rising line, drawn on.
  const pts = Array.from({ length: 9 }, (_, i) => ({
    x: i / 8,
    y: 0.85 - (i / 8) * 0.6 - (rand(i, 3) - 0.5) * 0.22,
  }));
  const d = pts
    .map((p, i) => `${i ? "L" : "M"}${(p.x * 100).toFixed(1)},${(p.y * 100).toFixed(1)}`)
    .join(" ");
  const drawn = easeOut((frame - 14) / 24);
  return (
    <AbsoluteFill
      style={{
        background: APP_FILL,
        color: APP_INK,
        fontSize: size,
        padding: size * 1.3,
        paddingTop: phone ? size * 4.2 : size * 1.3,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: size,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: size * 1.25 }}>{g.text || "Overview"}</div>
      <div style={{ display: "flex", gap: size, flexDirection: phone ? "column" : "row" }}>
        <div
          style={{
            flex: 1,
            background: APP_BG,
            borderRadius: size * 0.8,
            padding: size,
            border: `1px solid ${APP_LINE}`,
          }}
        >
          <div style={{ color: APP_SOFT, fontSize: size * 0.85 }}>
            {g.items[0] ? "Total" : "This month"}
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: size * 2.4,
              letterSpacing: "-0.03em",
              fontVariantNumeric: "tabular-nums",
              color: APP_INK,
            }}
          >
            {value ?? "—"}
          </div>
          <div style={{ color: "#16A34A", fontSize: size * 0.85, fontWeight: 600 }}>
            ▲ trending up
          </div>
        </div>
        <div
          style={{
            flex: 1.4,
            background: APP_BG,
            borderRadius: size * 0.8,
            padding: size,
            border: `1px solid ${APP_LINE}`,
            minHeight: size * 6,
          }}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              width: "100%",
              height: size * 5,
              display: "block",
              overflow: "visible",
              // Drawn on left to right.
              clipPath: `inset(-10% ${(1 - drawn) * 100}% -10% 0)`,
            }}
          >
            <path
              d={d}
              fill="none"
              stroke={accent}
              strokeWidth={2.2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>
      <div
        style={{
          background: APP_BG,
          borderRadius: size * 0.8,
          border: `1px solid ${APP_LINE}`,
          overflow: "hidden",
        }}
      >
        {g.items.map((label, i) => {
          const p = easeOut((frame - 18 - i * 5) / 10);
          const share = 0.35 + rand(i, 7) * 0.6;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: size,
                padding: `${size * 0.7}px ${size}px`,
                borderTop: i ? `1px solid ${APP_LINE}` : undefined,
                opacity: p,
              }}
            >
              <span style={{ flex: 1 }}>{label}</span>
              <span
                style={{
                  width: "38%",
                  height: size * 0.5,
                  borderRadius: size,
                  background: APP_FILL,
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${share * p * 100}%`,
                    borderRadius: size,
                    background: accent,
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** A sales page: the brand, a headline, a few features and a button the cursor clicks. */
function PageScreen({
  g,
  frame,
  unit,
  phone,
  accent,
  host,
  clicked,
}: {
  g: PlacedGraphic;
  frame: number;
  unit: number;
  phone: boolean;
  accent: string;
  host: string;
  clicked: boolean;
}) {
  const size = unit * (phone ? 2.7 : 1.9);
  const brand = host.split(".")[0] || "Brand";
  const p = (delay: number) => {
    const t = easeOut((frame - delay) / 12);
    return { opacity: t, transform: `translateY(${(1 - t) * size}px)` };
  };
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${APP_BG} 0%, ${APP_FILL} 100%)`,
        color: APP_INK,
        fontSize: size,
        padding: size * 1.6,
        paddingTop: phone ? size * 3.8 : size * 1.2,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: size * 0.5,
          fontWeight: 700,
          textTransform: "capitalize",
        }}
      >
        <span
          style={{
            width: size * 1.2,
            height: size * 1.2,
            borderRadius: size * 0.35,
            background: accent,
          }}
        />
        {brand}
        <span style={{ flex: 1 }} />
        {!phone &&
          ["Product", "Pricing", "About"].map((l) => (
            <span
              key={l}
              style={{ fontWeight: 500, color: APP_SOFT, fontSize: size * 0.85, marginLeft: size }}
            >
              {l}
            </span>
          ))}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          gap: size,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: size * (phone ? 2.1 : 2.6),
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
            ...p(4),
          }}
        >
          {splitWords(g.text, g.emphasis).map(({ w, special }, i) => (
            <span key={i} style={special ? { color: accent } : undefined}>
              {w}{" "}
            </span>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: size * 0.5,
            alignItems: "flex-start",
            ...p(10),
          }}
        >
          {g.items.slice(0, 3).map((f, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: size * 0.5, color: APP_SOFT }}
            >
              <Check size={size} color={accent} strokeWidth={3} />
              {f}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: size * 0.6,
            padding: `${size * 0.8}px ${size * 2}px`,
            borderRadius: size * 2,
            background: clicked ? APP_INK : accent,
            color: "#FFFFFF",
            fontWeight: 700,
            ...p(14),
          }}
        >
          {clicked ? "You're in ✓" : "Get started"}
        </div>
      </div>
    </AbsoluteFill>
  );
}
