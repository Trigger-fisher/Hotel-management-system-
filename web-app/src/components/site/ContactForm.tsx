"use client";

import { useState, type FormEvent } from "react";
import { demoRequestLimits as L } from "@shared/dashboards/demoRequests";
import { contactPage } from "@shared/site/pages";

import { tr } from '@/lib/i18n/language';
// The website's demo request form (/contact; platform 0169). Posts to the public route on the same site; the server checks every field again and answers with the field in
// error. A hidden field catches bots. After sending, the form is replaced by the thank-you note.

const T = contactPage.form;
type Field = "name" | "email" | "phone" | "hotelName" | "city" | "rooms" | "properties" | "message";

const num = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};

export function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Partial<Record<Field, string>>>({});

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    setProblem(null);
    setFields({});
    const body = {
      name: String(f.get("name") ?? ""),
      email: String(f.get("email") ?? ""),
      phone: String(f.get("phone") ?? "") || null,
      hotelName: String(f.get("hotelName") ?? ""),
      city: String(f.get("city") ?? "") || null,
      rooms: num(f.get("rooms")),
      properties: num(f.get("properties")),
      message: String(f.get("message") ?? "") || null,
      website: String(f.get("website") ?? ""),
    };
    try {
      const res = await fetch("/api/v1/public/demo-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        setState("done");
        return;
      }
      const err = (await res.json().catch(() => null)) as { error?: { message?: string; details?: { fields?: Record<string, string> } } } | null;
      setFields((err?.error?.details?.fields ?? {}) as Partial<Record<Field, string>>);
      setProblem(res.status === 429 ? T.tooMany : res.status === 400 || res.status === 422 ? (err?.error?.message ?? T.failed) : T.failed);
    } catch {
      setProblem(T.failed);
    }
    setState("idle");
  }

  if (state === "done") {
    return (
      <div className="hp-form hp-form-done" role="status">
        <h2>{T.done.title}</h2>
        <p>{T.done.body}</p>
      </div>
    );
  }

  const input = (name: Field, label: string, opts: { type?: string; required?: boolean; max?: number; autoComplete?: string; inputMode?: "numeric" | "tel" | "email"; min?: number; wide?: boolean } = {}) => (
    <label className={`hp-fld${opts.wide ? " hp-fld-wide" : ""}`}>
      <span>{label}{opts.required ? null : <i>{T.optional}</i>}</span>
      <input
        name={name}
        type={opts.type ?? "text"}
        required={opts.required}
        maxLength={opts.type === "number" ? undefined : opts.max}
        min={opts.type === "number" ? opts.min ?? 1 : undefined}
        max={opts.type === "number" ? opts.max : undefined}
        autoComplete={opts.autoComplete}
        inputMode={opts.inputMode}
        aria-invalid={fields[name] ? true : undefined}
        aria-describedby={fields[name] ? `${name}-err` : undefined}
      />
      {fields[name] ? <em id={`${name}-err`}>{fields[name]}</em> : null}
    </label>
  );

  return (
    <form className="hp-form" onSubmit={submit}>
      <div className="hp-form-grid">
        {input("name", T.name, { required: true, max: L.name, autoComplete: "name" })}
        {input("email", T.email, { type: "email", required: true, max: L.email, autoComplete: "email", inputMode: "email" })}
        {input("hotelName", T.hotelName, { required: true, max: L.hotelName, autoComplete: "organization" })}
        {input("phone", T.phone, { type: "tel", max: L.phone, autoComplete: "tel", inputMode: "tel" })}
        {input("city", T.city, { max: L.city, autoComplete: "address-level2" })}
        {input("rooms", T.rooms, { type: "number", max: L.rooms, inputMode: "numeric" })}
        {input("properties", T.properties, { type: "number", max: L.properties, inputMode: "numeric" })}
        <label className="hp-fld hp-fld-wide">
          <span>{T.message}<i>{T.optional}</i></span>
          <textarea name="message" rows={4} maxLength={L.message} aria-describedby="message-hint" />
          <small id="message-hint">{T.messageHint}</small>
          {fields.message ? <em>{fields.message}</em> : null}
        </label>
        {/* the honeypot: hidden from people and from screen readers */}
        <label className="hp-trap" aria-hidden="true">
          {tr("Website")}
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {problem ? <p className="hp-form-error" role="alert">{problem}</p> : null}
      <button className="hp-btn hp-btn-solid hp-btn-lg" type="submit" disabled={state === "sending"}>{state === "sending" ? T.sending : T.submit}</button>
      <p className="hp-form-note">{T.consent} <a href="/privacy">{T.privacyLink}</a>.</p>
    </form>
  );
}
