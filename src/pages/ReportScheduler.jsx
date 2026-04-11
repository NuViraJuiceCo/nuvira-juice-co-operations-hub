import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Mail, Calendar, FileText, Send, Clock, CheckCircle2, AlertCircle, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import moment from "moment";

const PRESETS = [
  { label: "Last 7 Days", start: () => moment().subtract(6, "days").format("YYYY-MM-DD"), end: () => moment().format("YYYY-MM-DD") },
  { label: "Last 14 Days", start: () => moment().subtract(13, "days").format("YYYY-MM-DD"), end: () => moment().format("YYYY-MM-DD") },
  { label: "This Month", start: () => moment().startOf("month").format("YYYY-MM-DD"), end: () => moment().format("YYYY-MM-DD") },
  { label: "Last Month", start: () => moment().subtract(1, "month").startOf("month").format("YYYY-MM-DD"), end: () => moment().subtract(1, "month").endOf("month").format("YYYY-MM-DD") },
  { label: "Last 30 Days", start: () => moment().subtract(29, "days").format("YYYY-MM-DD"), end: () => moment().format("YYYY-MM-DD") },
  { label: "Custom", start: null, end: null },
];

const REPORT_SECTIONS = [
  { key: "financial", label: "Financial Summary", desc: "Revenue, orders, avg value, channel breakdown, daily trend" },
  { key: "operational", label: "Operational Summary", desc: "Production batches, units planned/produced, fulfillment tasks" },
];

export default function ReportScheduler() {
  const { user } = useAuth();
  const [preset, setPreset] = useState(0);
  const [startDate, setStartDate] = useState(PRESETS[0].start());
  const [endDate, setEndDate] = useState(PRESETS[0].end());
  const [email, setEmail] = useState(user?.email || "");
  const [sections, setSections] = useState(["financial", "operational"]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const selectPreset = (i) => {
    setPreset(i);
    setResult(null);
    setError(null);
    if (PRESETS[i].start) {
      setStartDate(PRESETS[i].start());
      setEndDate(PRESETS[i].end());
    }
  };

  const toggleSection = (key) => {
    setSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleGenerate = async () => {
    if (!email) { setError("Please enter a recipient email."); return; }
    if (sections.length === 0) { setError("Select at least one report section."); return; }
    setLoading(true);
    setResult(null);
    setError(null);
    const res = await base44.functions.invoke("generateWeeklyReport", {
      start_date: startDate,
      end_date: endDate,
      recipient_email: email,
      report_types: sections,
    });
    setLoading(false);
    if (res.data?.success) {
      setResult(res.data);
    } else {
      setError(res.data?.error || "Failed to generate report. Please try again.");
    }
  };

  const days = moment(endDate).diff(moment(startDate), "days") + 1;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Report Scheduler</h1>
        <p className="text-muted-foreground mt-1">Generate and email PDF financial & operational reports</p>
      </div>

      {/* Date Range */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Date Range</h2>
          <span className="ml-auto text-xs text-muted-foreground">{days} day{days !== 1 ? "s" : ""}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => (
            <button key={p.label} onClick={() => selectPreset(i)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${preset === i ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground hover:bg-muted"}`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Start Date</label>
            <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPreset(5); }} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">End Date</label>
            <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPreset(5); }} />
          </div>
        </div>
      </div>

      {/* Report Sections */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Report Sections</h2>
        </div>
        <div className="space-y-3">
          {REPORT_SECTIONS.map(section => (
            <label key={section.key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${sections.includes(section.key) ? "bg-primary/5 border-primary/30" : "bg-background border-border hover:bg-muted/30"}`}>
              <input type="checkbox" checked={sections.includes(section.key)} onChange={() => toggleSection(section.key)} className="mt-0.5 accent-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">{section.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{section.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Recipient */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Send To</h2>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Recipient Email</label>
          <Input type="email" placeholder="amar@nuvirajuice.ca" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
      </div>

      {/* Scheduled Delivery Info */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <Clock className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Automated Weekly Delivery</p>
          <p className="text-xs text-amber-700 mt-0.5">A weekly report (last 7 days) is automatically emailed every Monday at 8:00 AM to the admin email. Use the button below to send a one-off report for any custom date range.</p>
        </div>
      </div>

      {/* Error / Success */}
      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-emerald-800">Report generated and sent!</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Revenue", value: `$${result.summary?.total_revenue?.toFixed(2) || "0.00"}` },
              { label: "Orders", value: result.summary?.total_orders || 0 },
              { label: "Batches", value: result.summary?.batches || 0 },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-lg p-3 border border-emerald-100 text-center">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-emerald-700">{s.value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-emerald-700">Sent to <strong>{result.sent_to}</strong> · Period: {result.period?.start} to {result.period?.end}</p>
          {result.file_url && (
            <a href={result.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <FileText className="h-4 w-4" /> Download PDF Report
            </a>
          )}
        </div>
      )}

      <Button onClick={handleGenerate} disabled={loading} size="lg" className="w-full gap-2">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating Report...</> : <><Send className="h-4 w-4" /> Generate & Send Report</>}
      </Button>
    </div>
  );
}