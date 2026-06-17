import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { Select } from "../components/Select.js";
import { StatusTimeline, type Step } from "../components/StatusTimeline.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import type { IClosedResult, IClosedProgress } from "../../electron/ipc.js";
import type { Campaign, CampaignLink } from "../../src/types.js";

const campaignUrlFor = (hash: string) => `https://dev.iclosed.io/campaign?plan_hash=${hash}`;

// Ported from the module's renderer.js generatePassword: 12 chars, >=1 of each
// class, shuffled (Fisher–Yates).
function generatePassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*?";
  const all = upper + lower + digits + special;
  const rand = (set: string) => set[Math.floor(Math.random() * set.length)];
  const required = [rand(upper), rand(lower), rand(digits), rand(special)];
  const rest = Array.from({ length: length - required.length }, () => rand(all));
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

type RunState = "idle" | "running" | "success" | "error";

// Module-level form cache: survives tab switches (the page remounts) but is
// reset when the app restarts (module reloads), so a fresh launch loads the
// latest defaults rather than the previous session's picks.
const sessionForm = {
  campaignUrl: "",
  selectedCampaign: "",
  selectedLink: "",
  emailMode: "random" as "random" | "custom",
  email: "",
  password: "Demo@123",
  headless: true,
  closeWhenDone: false,
};

export function CreateUser({ profile }: { profile: string }) {
  // Selections persist within the session (across tab switches) via sessionForm.
  const [campaignUrl, setCampaignUrl] = useState(sessionForm.campaignUrl);

  // Campaigns dropdown — lazy: fetched fresh each time it's opened.
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState(sessionForm.selectedCampaign); // campaign id

  // Campaign Link dropdown — fetched from the back-office API for the selected campaign.
  const [links, setLinks] = useState<CampaignLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState(sessionForm.selectedLink); // hash

  async function loadCampaigns() {
    setLoadingCampaigns(true); setCampaignsError(null);
    const r = await api.listCampaigns(profile);
    setLoadingCampaigns(false);
    if (!r.ok) { setCampaignsError(r.error); return; }
    setCampaigns(r.data);
    // Default-select the latest (first) campaign if nothing is chosen yet.
    if (!selectedCampaign && r.data.length > 0) onPickCampaign(String(r.data[0].id));
  }

  async function loadLinks(campaignId: string) {
    if (!campaignId) return;
    setLoadingLinks(true); setLinksError(null);
    const r = await api.listCampaignLinks(profile, Number(campaignId));
    setLoadingLinks(false);
    if (!r.ok) { setLinksError(r.error); setLinks([]); return; }
    setLinks(r.data);
    // Default-select the first link and fill the URL (if none chosen / URL empty).
    if (r.data.length > 0 && !selectedLink) onPickLink(r.data[0].hash, !campaignUrl);
  }

  // Initial load: populate campaigns; if a campaign was previously selected, also
  // load its links so the saved Campaign Link shows. Otherwise default to latest.
  useEffect(() => {
    loadCampaigns();
    if (selectedCampaign) loadLinks(selectedCampaign);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [profile]);

  function onPickCampaign(id: string) {
    setSelectedCampaign(id);
    setSelectedLink(""); setLinks([]); setLinksError(null);
    loadLinks(id);
  }

  function onPickLink(hash: string, setUrl = true) {
    setSelectedLink(hash);
    if (hash && setUrl) setCampaignUrl(campaignUrlFor(hash));
  }
  const [emailMode, setEmailMode] = useState<"random" | "custom">(sessionForm.emailMode);
  const [email, setEmail] = useState(sessionForm.email);
  const [password, setPassword] = useState(sessionForm.password);
  const [headless, setHeadless] = useState(sessionForm.headless);
  const [closeWhenDone, setCloseWhenDone] = useState(sessionForm.closeWhenDone);

  // Mirror selections/inputs into the module cache so they survive tab switches.
  useEffect(() => {
    Object.assign(sessionForm, { campaignUrl, selectedCampaign, selectedLink, emailMode, email, password, headless, closeWhenDone });
  }, [campaignUrl, selectedCampaign, selectedLink, emailMode, email, password, headless, closeWhenDone]);

  const [state, setState] = useState<RunState>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<IClosedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(
    () =>
      api.onIClosedProgress((p: IClosedProgress) => {
        if (p.step?.startsWith("DBG")) return; // skip debug dumps
        setSteps((s) => [...s, { step: p.step, message: p.detail ?? (p.error ? p.error : "") }]);
      }),
    [],
  );

  const running = state === "running";
  const canRun = !running && campaignUrl.trim() !== "" && password.trim() !== "" && (emailMode === "random" || email.trim() !== "");

  async function run() {
    setState("running"); setSteps([]); setResult(null); setError(null);
    const res = await api.createIClosedUser({
      campaignUrl: campaignUrl.trim(),
      emailMode,
      email: emailMode === "custom" ? email.trim() : undefined,
      password,
      headed: !headless,
      keepOpen: !closeWhenDone,
    });
    if (!res.ok) { setError(res.error); setState("error"); return; }
    setResult(res.data); setState("success");
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(label); setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div className="max-w-[820px]">
      <h1 className="ic-page-title">Create user</h1>

      <div className="max-w-[420px]">
        <span className="ic-label">Campaign</span>
        <SearchableSelect
          options={campaigns.map((c) => ({ label: c.name, value: String(c.id) }))}
          value={selectedCampaign}
          onChange={onPickCampaign}
          onOpen={loadCampaigns}
          loading={loadingCampaigns}
          disabled={running}
          placeholder="Select a campaign…"
        />
      </div>
      {campaignsError && <div className="mt-3 max-w-[420px]"><Banner kind="error" title="Couldn't load campaigns">{campaignsError}</Banner></div>}

      <div className="mt-4 max-w-[420px]">
        <span className="ic-label">Campaign Link</span>
        <SearchableSelect
          options={links.map((l) => ({ label: l.label, value: l.hash }))}
          value={selectedLink}
          onChange={(h) => onPickLink(h)}
          onOpen={() => loadLinks(selectedCampaign)}
          loading={loadingLinks}
          disabled={running || !selectedCampaign}
          placeholder={selectedCampaign ? "Select a campaign link…" : "Pick a campaign first"}
        />
      </div>
      {linksError && <div className="mt-3 max-w-[420px]"><Banner kind="error" title="Couldn't load campaign links">{linksError}</Banner></div>}

      <div className="mt-4 max-w-[640px]">
        <Field label="Campaign URL" value={campaignUrl} onChange={setCampaignUrl}
          placeholder="https://dev.iclosed.io/campaign?plan_hash=…" />
      </div>

      <span className="ic-label mt-4">Email</span>
      <div className="flex items-center gap-[22px]">
        <label className="flex cursor-pointer items-center gap-[7px] text-[13px] text-strong">
          <input type="radio" checked={emailMode === "random"} onChange={() => setEmailMode("random")} disabled={running} className="h-[15px] w-[15px]" />
          Random
        </label>
        <label className="flex cursor-pointer items-center gap-[7px] text-[13px] text-strong">
          <input type="radio" checked={emailMode === "custom"} onChange={() => setEmailMode("custom")} disabled={running} className="h-[15px] w-[15px]" />
          User-Defined
        </label>
      </div>
      {emailMode === "custom" && (
        <div className="mt-2.5 max-w-[420px]">
          <Field label="" value={email} onChange={setEmail} placeholder="user@example.com" />
        </div>
      )}

      <span className="ic-label mt-4">Password</span>
      <div className="flex max-w-[540px] items-center gap-2.5">
        <div className="flex-1"><Field label="" value={password} onChange={setPassword} /></div>
        <button onClick={() => setPassword(generatePassword())} disabled={running} className="ic-btn-secondary whitespace-nowrap px-4 py-[7px] text-[12.5px]">
          Regenerate
        </button>
      </div>

      <span className="ic-label mt-4">Browser mode</span>
      <div className="flex flex-wrap items-center gap-4">
        <Select value={headless ? "headless" : "headed"} onChange={(v) => setHeadless(v === "headless")} disabled={running} className="w-[150px]">
          <option value="headless">Headless</option>
          <option value="headed">Headed</option>
        </Select>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-strong">
          <input type="checkbox" checked={closeWhenDone} onChange={(e) => setCloseWhenDone(e.target.checked)} disabled={running} className="h-[15px] w-[15px]" />
          Close browser when done
        </label>
      </div>

      <button disabled={!canRun} onClick={run} className="ic-btn-primary mt-[18px] px-[22px] py-[9px] text-[13px]">
        {running ? "Creating…" : "Create"}
      </button>

      {steps.length > 0 && (
        <div className="ic-card mt-[22px] p-[18px]">
          <StatusTimeline steps={steps} done={state === "success"} failed={state === "error"} />
        </div>
      )}

      {error && <div className="mt-3.5"><Banner kind="error" title="Create failed">{error}</Banner></div>}

      {result && (
        <div className="mt-3.5">
          <Banner kind="success" title="User created">
            <div className="space-y-1 font-mono text-[12px] text-ok">
              {([
                ["Email", result.email],
                ["Password", result.password],
                ["Username", result.username],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span className="w-16 font-bold text-ok">{label}</span>
                  <span className="text-ink">{value}</span>
                  <button onClick={() => copy(label, value)} className="cursor-pointer border-none bg-transparent px-1 text-[12px] font-bold text-navy">
                    {copied === label ? "copied" : "copy"}
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2.5">
                <span className="w-16 font-bold text-ok">Workspace</span>
                <a href="#" onClick={(e) => { e.preventDefault(); api.openExternal(result.workspaceUrl); }} className="text-navy hover:underline">{result.workspaceUrl}</a>
                <button onClick={() => copy("Workspace", result.workspaceUrl)} className="cursor-pointer border-none bg-transparent px-1 text-[12px] font-bold text-navy">
                  {copied === "Workspace" ? "copied" : "copy"}
                </button>
              </div>
            </div>
          </Banner>
        </div>
      )}
    </div>
  );
}
