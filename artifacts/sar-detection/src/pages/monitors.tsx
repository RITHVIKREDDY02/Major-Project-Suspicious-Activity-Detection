import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Radio, Play, Square, Trash2, Plus, Phone, Link as LinkIcon,
  Activity, AlertTriangle, Clock, Wifi, ShieldAlert
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Monitor = {
  id: number;
  name: string;
  streamUrl: string;
  whatsappNumber: string;
  status: string;
  intervalSeconds: number;
  alertsEnabled: boolean;
  lastCheckedAt: string | null;
  lastAlertAt: string | null;
  createdAt: string;
};

async function fetchMonitors(): Promise<Monitor[]> {
  const r = await fetch(`${BASE}/api/monitors`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed to fetch monitors");
  return r.json();
}

async function createMonitor(data: Omit<Monitor, "id" | "status" | "lastCheckedAt" | "lastAlertAt" | "createdAt">): Promise<Monitor> {
  const r = await fetch(`${BASE}/api/monitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error("Failed to create monitor");
  return r.json();
}

async function startMonitor(id: number): Promise<Monitor> {
  const r = await fetch(`${BASE}/api/monitors/${id}/start`, { method: "PATCH", credentials: "include" });
  if (!r.ok) throw new Error("Failed to start monitor");
  return r.json();
}

async function stopMonitor(id: number): Promise<Monitor> {
  const r = await fetch(`${BASE}/api/monitors/${id}/stop`, { method: "PATCH", credentials: "include" });
  if (!r.ok) throw new Error("Failed to stop monitor");
  return r.json();
}

async function deleteMonitor(id: number): Promise<void> {
  const r = await fetch(`${BASE}/api/monitors/${id}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error("Failed to delete monitor");
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return (
    <Badge className="bg-green-500/20 text-green-400 border-green-500/40 gap-1.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      LIVE
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-muted-foreground gap-1.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
      Stopped
    </Badge>
  );
}

function MonitorCard({ monitor, onStart, onStop, onDelete, loading }: {
  monitor: Monitor;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  loading: boolean;
}) {
  const isActive = monitor.status === "active";
  return (
    <Card className={`border ${isActive ? "border-green-500/30 bg-green-500/5" : "border-border"} transition-colors`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Radio className="w-4 h-4 text-primary shrink-0" />
              <p className="font-semibold truncate">{monitor.name}</p>
              <StatusBadge status={monitor.status} />
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">{monitor.streamUrl}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={loading}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Phone className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{monitor.whatsappNumber}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Every {monitor.intervalSeconds}s</span>
          </div>
          {monitor.lastCheckedAt && (
            <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span>Last check: {new Date(monitor.lastCheckedAt).toLocaleTimeString()}</span>
            </div>
          )}
          {monitor.lastAlertAt && (
            <div className="flex items-center gap-1.5 text-yellow-500 col-span-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Last alert: {new Date(monitor.lastAlertAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          {isActive ? (
            <Button variant="outline" size="sm" className="flex-1" onClick={onStop} disabled={loading}>
              <Square className="w-3.5 h-3.5 mr-1.5" /> Stop
            </Button>
          ) : (
            <Button size="sm" className="flex-1" onClick={onStart} disabled={loading}>
              <Play className="w-3.5 h-3.5 mr-1.5" /> Start Monitor
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const DEFAULT_FORM = {
  name: "",
  streamUrl: "",
  whatsappNumber: "",
  intervalSeconds: 30,
  alertsEnabled: true,
};

export default function MonitorsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);

  const { data: monitors = [], isLoading } = useQuery({
    queryKey: ["monitors"],
    queryFn: fetchMonitors,
    refetchInterval: 15000,
  });

  const createMutation = useMutation({
    mutationFn: createMonitor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      toast({ title: "Monitor created", description: "The background monitor is ready to start." });
      setForm(DEFAULT_FORM);
      setShowForm(false);
    },
    onError: () => toast({ title: "Failed to create monitor", variant: "destructive" }),
  });

  const startMutation = useMutation({
    mutationFn: startMonitor,
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      toast({ title: `Monitor "${m.name}" started`, description: "Running in background — WhatsApp alerts will be sent when suspicious activity is detected." });
    },
    onError: () => toast({ title: "Failed to start monitor", variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: stopMonitor,
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      toast({ title: `Monitor "${m.name}" stopped` });
    },
    onError: () => toast({ title: "Failed to stop monitor", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMonitor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      toast({ title: "Monitor deleted" });
    },
    onError: () => toast({ title: "Failed to delete monitor", variant: "destructive" }),
  });

  const isMutating = startMutation.isPending || stopMutation.isPending || deleteMutation.isPending;

  const activeCount = monitors.filter((m) => m.status === "active").length;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.streamUrl || !form.whatsappNumber) return;
    createMutation.mutate(form);
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">Live Monitors</h1>
          <p className="text-muted-foreground mt-1">Background CCTV stream monitors with WhatsApp alerts</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0">
          <Plus className="w-4 h-4 mr-2" /> Add Monitor
        </Button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-6 p-4 rounded-xl border border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <Wifi className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium">{activeCount} active monitor{activeCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <ShieldAlert className="w-4 h-4" />
          <span>WhatsApp alerts with 5-min cooldown</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Activity className="w-4 h-4" />
          <span>Runs 24/7 on the server</span>
        </div>
        <Link href="/detections" className="ml-auto">
          <Button variant="outline" size="sm" className="text-xs h-8">View Detection Log</Button>
        </Link>
      </div>

      {/* Add form */}
      {showForm && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="w-4 h-4" /> New Background Monitor
            </CardTitle>
            <CardDescription>
              Configure a CCTV stream to monitor continuously. A WhatsApp alert is sent when suspicious activity is detected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Monitor Name</Label>
                  <Input
                    placeholder="Front Gate Camera"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Check Interval (seconds)</Label>
                  <Input
                    type="number"
                    min={10}
                    max={3600}
                    value={form.intervalSeconds}
                    onChange={(e) => setForm((f) => ({ ...f, intervalSeconds: parseInt(e.target.value) || 30 }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Stream URL</Label>
                <div className="relative">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="rtsp://192.168.1.100:554/stream  or  http://cam.example.com/mjpeg"
                    value={form.streamUrl}
                    onChange={(e) => setForm((f) => ({ ...f, streamUrl: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>WhatsApp Alert Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="+91 98765 43210"
                    value={form.whatsappNumber}
                    onChange={(e) => setForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Include country code (e.g. +91 for India). A WhatsApp message will be sent to this number when suspicious activity is detected.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="alerts-enabled"
                  checked={form.alertsEnabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, alertsEnabled: v }))}
                />
                <Label htmlFor="alerts-enabled">Enable WhatsApp alerts</Label>
              </div>

              <div className="flex gap-3 pt-1">
                <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Monitor"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Monitors list */}
      {isLoading ? (
        <div className="text-muted-foreground py-12">Loading monitors...</div>
      ) : monitors.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-xl p-12 text-center text-muted-foreground">
          <Radio className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <h3 className="font-semibold text-foreground mb-1">No monitors configured</h3>
          <p className="text-sm max-w-sm mx-auto">
            Add a CCTV stream URL and a WhatsApp number. The server will monitor it around the clock and send you a WhatsApp alert instantly when suspicious activity is detected.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {monitors.map((m) => (
            <MonitorCard
              key={m.id}
              monitor={m}
              loading={isMutating}
              onStart={() => startMutation.mutate(m.id)}
              onStop={() => stopMutation.mutate(m.id)}
              onDelete={() => deleteMutation.mutate(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
