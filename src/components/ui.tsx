"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { fileToDataUrl } from "@/lib/client";

export function cx(...v: (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(" ");
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled,
  title,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "soft" | "accent";
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all select-none disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] whitespace-nowrap";
  const sizes = {
    xs: "text-[11px] px-2 py-1",
    sm: "text-xs px-2.5 py-1.5",
    md: "text-sm px-3.5 py-2",
  };
  const variants = {
    primary:
      "bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-900/30 hover:from-violet-500 hover:to-fuchsia-500",
    accent: "bg-amber-500/90 text-slate-950 hover:bg-amber-400",
    ghost: "text-slate-300 hover:bg-white/10 hover:text-white border border-white/10",
    soft: "bg-white/5 text-slate-200 hover:bg-white/10 border border-white/10",
    danger: "text-rose-300 hover:bg-rose-500/15 border border-rose-500/25",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(base, sizes[size], variants[variant], className)}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 py-1 text-left"
    >
      <span
        className={cx(
          "mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-violet-500" : "bg-slate-600",
        )}
      >
        <span
          className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-slate-200 group-hover:text-white">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>}
      </span>
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  action,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl bg-[#111528] border border-white/10 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition duration-200 shadow-inner";

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={props.type ?? "text"}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
      className={cx(inputCls, props.className)}
    />
  );
}

export function AutoTextarea({
  value,
  onChange,
  minRows = 3,
  maxRows = 18,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  minRows?: number;
  maxRows?: number;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lh = 21;
    const max = maxRows * lh + 16;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value, maxRows]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
      className={cx(inputCls, "resize-none leading-[21px]", rest.className)}
    />
  );
}

/* ---------------- AI Writer button ---------------- */

export function WriterButton({
  busy,
  onClick,
  hasText,
  label = "AI Writer",
}: {
  busy?: boolean;
  onClick: () => void;
  hasText?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={
        hasText
          ? `${label}: expand what you have written using it as context`
          : `${label}: generate this block from all other context`
      }
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition",
        busy
          ? "border-violet-500/40 bg-violet-500/10 text-violet-300 cursor-wait"
          : "border-violet-400/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/25 hover:text-white",
      )}
    >
      <span className={busy ? "animate-pulse" : ""}>✍️</span>
      <span>{busy ? "Writing…" : hasText ? "Expand" : "Generate"}</span>
    </button>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity" onClick={onClose} />
      <div
        className={cx(
          "relative w-full overflow-hidden rounded-t-3xl sm:rounded-3xl border border-white/15 bg-[#111528] shadow-2xl flex flex-col animate-scale-in",
          wide ? "sm:max-w-4xl" : "sm:max-w-lg",
          "max-h-[92dvh] sm:max-h-[88dvh]",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5 shrink-0 bg-[#0d1120]">
          <h3 className="text-sm font-bold text-white truncate">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white transition"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-white/10 px-5 py-3.5 flex justify-end gap-2 bg-[#0d1120]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Image upload ---------------- */

export function ImageUpload({
  value,
  onChange,
  label,
  round,
  maxSize = 640,
  aspect = "aspect-square",
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  label: string;
  round?: boolean;
  maxSize?: number;
  aspect?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");

  async function handle(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Please choose an image file (PNG, JPG, WEBP).");
      return;
    }
    try {
      setErr("");
      onChange(await fileToDataUrl(file, maxSize));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </label>
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-[11px] text-rose-300 hover:text-rose-200"
          >
            Remove
          </button>
        )}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handle(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={cx(
          "relative w-full cursor-pointer overflow-hidden border-2 border-dashed transition",
          round ? "rounded-full max-w-[140px] mx-auto" : "rounded-xl",
          aspect,
          drag ? "border-violet-400 bg-violet-500/10" : "border-white/15 bg-slate-900/60 hover:border-violet-400/60",
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
            <span className="text-2xl">🖼️</span>
            <span className="text-[11px] text-slate-400">Tap or drop an image</span>
            <span className="text-[10px] text-slate-600">PNG · JPG · WEBP</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {err && <p className="text-[11px] text-rose-400">{err}</p>}
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src?: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      style={{ width: size, height: size }}
      className={cx("shrink-0 rounded-full object-cover ring-1 ring-white/15", className)}
    />
  ) : (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={cx(
        "shrink-0 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-700 grid place-items-center font-bold text-white ring-1 ring-white/15",
        className,
      )}
    >
      {initials}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <span className="font-mono text-violet-300">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-500"
      />
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; icon?: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/70 p-1 border border-white/10 no-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition",
            active === t.id
              ? "bg-violet-600 text-white shadow"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
          )}
        >
          {t.icon && <span className="mr-1">{t.icon}</span>}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Toast({ msg, kind }: { msg: string; kind: "ok" | "err" }) {
  return (
    <div
      className={cx(
        "pointer-events-none fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-xl border backdrop-blur",
        kind === "ok"
          ? "bg-emerald-600/90 border-emerald-400/40 text-white"
          : "bg-rose-700/90 border-rose-400/40 text-white",
      )}
    >
      {msg}
    </div>
  );
}
