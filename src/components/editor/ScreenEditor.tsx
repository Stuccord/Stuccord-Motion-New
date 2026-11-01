// An app screen in the graphic panel: what it shows (a picture, or a chat,
// dashboard or sales page drawn from its words), the device, and its web
// address - which can be captured as the screen's picture (the worker
// screenshots public pages only) - or an uploaded screenshot.

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  EMPTY_SCREEN,
  SCREEN_DEVICES,
  SCREEN_KINDS,
  maxItems,
  type MotionElement,
} from "@/lib/motion-plan";
import { Slot, type PictureTools } from "./PictureSetEditor";

const KIND_LABEL: Record<(typeof SCREEN_KINDS)[number], string> = {
  picture: "Picture",
  chat: "Chat",
  dashboard: "Dashboard",
  page: "Sales page",
};
const DEVICE_LABEL: Record<(typeof SCREEN_DEVICES)[number], string> = {
  auto: "By video shape",
  phone: "Phone",
  browser: "Browser",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

export function ScreenEditor({
  element: el,
  tools,
  readOnly,
  portrait,
  onChange,
  inputCls,
}: {
  element: MotionElement;
  tools: PictureTools;
  readOnly: boolean;
  /** The video is tall: "by video shape" means a phone. */
  portrait: boolean;
  onChange: (patch: Partial<MotionElement>) => void;
  inputCls: string;
}) {
  const s = el.screen ?? EMPTY_SCREEN;
  const setScreen = (patch: Partial<typeof s>) => onChange({ screen: { ...s, ...patch } });
  const [address, setAddress] = useState(s.url);
  const device = s.device === "phone" || (s.device === "auto" && portrait) ? "phone" : "browser";
  const capturing = tools.busy.has(`${el.id}:0`);
  const picturePath = el.scenes?.[0]?.image?.path;
  const pictureUrl = picturePath ? tools.urls[picturePath] : undefined;
  const items = (label: string) => (
    <Field label={label}>
      <Textarea
        value={el.items.join("\n")}
        readOnly={readOnly}
        onChange={(e) =>
          onChange({
            items: e.target.value
              .split("\n")
              .map((l) => l.slice(0, 80))
              .slice(0, maxItems("screen")),
          })
        }
        className={cn(inputCls, "min-h-[72px] resize-none font-mono")}
      />
    </Field>
  );
  const text = (label: string, max = 200) => (
    <Field label={label}>
      <Input
        value={el.text}
        maxLength={max}
        readOnly={readOnly}
        onChange={(e) => onChange({ text: e.target.value })}
        className={cn(inputCls, "h-8")}
      />
    </Field>
  );

  return (
    <div className="space-y-3">
      <Field label="Shows">
        <div
          className="grid grid-cols-4 gap-1"
          role="radiogroup"
          aria-label="What the screen shows"
        >
          {SCREEN_KINDS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={s.kind === k}
              disabled={readOnly}
              onClick={() => setScreen({ kind: k })}
              className={cn(
                "h-7 rounded-md border text-[10px] font-medium disabled:opacity-60",
                s.kind === k
                  ? "border-blue-400/60 bg-blue-500/15 text-blue-100"
                  : "border-white/10 bg-white/[0.03] text-neutral-400 hover:text-white",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Device">
        <select
          value={s.device}
          disabled={readOnly}
          onChange={(e) => setScreen({ device: e.target.value as typeof s.device })}
          className={cn(inputCls, "w-full h-8 rounded-md px-2")}
        >
          {SCREEN_DEVICES.map((d) => (
            <option key={d} value={d}>
              {DEVICE_LABEL[d]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Web address (optional)">
        <div className="flex gap-1.5">
          <Input
            value={address}
            maxLength={200}
            readOnly={readOnly}
            placeholder="stripe.com"
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => address !== s.url && setScreen({ url: address.trim() })}
            className={cn(inputCls, "h-8")}
          />
          {!readOnly && (
            <button
              onClick={() => {
                setScreen({ url: address.trim() });
                void tools.capturePage(el.id, address.trim(), device);
              }}
              disabled={capturing || address.trim().length < 3}
              className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40"
            >
              {capturing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Camera className="w-3 h-3" />
              )}
              Capture page
            </button>
          )}
        </div>
        <span className="text-[10px] text-neutral-500 leading-snug">
          Shown in the browser bar. Capture takes a {device === "phone" ? "phone" : "laptop"}{" "}
          screenshot of a public page; pages behind a login or with pop-ups may not look right, so
          you can upload your own instead.
        </span>
      </Field>

      {s.kind === "picture" && (
        <Field label="Screenshot">
          <div className="w-24">
            <Slot
              url={pictureUrl}
              busy={capturing}
              readOnly={readOnly}
              label="Screenshot"
              onFile={(f) => void tools.setPicture(el.id, 0, f, "upload")}
              onClear={
                pictureUrl ? () => void tools.setPicture(el.id, 0, null, "upload") : undefined
              }
            />
          </div>
          <span className="text-[10px] text-neutral-500">
            Upload a screenshot (JPG, PNG or WebP), or capture a page above. Tall ones scroll.
          </span>
        </Field>
      )}

      {s.kind === "chat" && (
        <>
          {text("The question (typed in)", 120)}
          {items("The reply (one line each, up to 5)")}
        </>
      )}

      {s.kind === "dashboard" && (
        <>
          {text("Title", 60)}
          <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
            <Field label="Before">
              <Input
                value={el.number?.prefix ?? ""}
                maxLength={8}
                readOnly={readOnly}
                placeholder="$"
                onChange={(e) =>
                  onChange({
                    number: {
                      value: el.number?.value ?? 0,
                      suffix: el.number?.suffix ?? "",
                      prefix: e.target.value,
                    },
                  })
                }
                className={cn(inputCls, "h-8")}
              />
            </Field>
            <Field label="Headline number">
              <Input
                type="number"
                value={el.number ? String(el.number.value) : ""}
                readOnly={readOnly}
                placeholder="None"
                onChange={(e) => {
                  if (e.target.value === "") return onChange({ number: null });
                  const v = Number(e.target.value);
                  if (Number.isFinite(v))
                    onChange({
                      number: {
                        prefix: el.number?.prefix ?? "",
                        suffix: el.number?.suffix ?? "",
                        value: v,
                      },
                    });
                }}
                className={cn(inputCls, "h-8")}
              />
            </Field>
            <Field label="After">
              <Input
                value={el.number?.suffix ?? ""}
                maxLength={12}
                readOnly={readOnly}
                placeholder="K"
                onChange={(e) =>
                  onChange({
                    number: {
                      value: el.number?.value ?? 0,
                      prefix: el.number?.prefix ?? "",
                      suffix: e.target.value,
                    },
                  })
                }
                className={cn(inputCls, "h-8")}
              />
            </Field>
          </div>
          {items("Rows (one per line, up to 5)")}
        </>
      )}

      {s.kind === "page" && (
        <>
          {text("Headline", 80)}
          <Field label="Special word (accent colour)">
            <Input
              value={el.emphasis ?? ""}
              maxLength={60}
              readOnly={readOnly}
              placeholder="One word from the headline"
              onChange={(e) =>
                onChange({ emphasis: e.target.value.trim() ? e.target.value : null })
              }
              className={cn(inputCls, "h-8")}
            />
          </Field>
          {items("Features (one per line, up to 3 shown)")}
        </>
      )}
    </div>
  );
}
