import { useGetStatsSummary, useGetRecentActivity, useHealthCheck } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, CheckCircle2, Clock, Image as ImageIcon, Video, AlertCircle, Radio, Phone, Play, Square, ShieldAlert, Wifi } from "lucide-react";
import { Link } from "wouter";

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
};

async function fetchMonitors(): Promise<Monitor[]> {
  const r = await fetch(`${BASE}/api/monitors`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

async function startMonitor(id: number): Promise<Monitor> {
  const r = await fetch(`${BASE}/api/monitors/${id}/start`, { method: "PATCH", credentials: "include" });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

async function stopMonitor(id: number): Promise<Monitor> {
  const r = await fetch(`${BASE}/api/monitors/${id}/stop`, { method: "PATCH", credentials: "include" });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetStatsSummary();
  const { data: recent, isLoading: recentLoading } = useGetRecentActivity({ limit: 5 });
  const { data: health } = useHealthCheck();
  const qc = useQueryClient();

  const { data: monitors = [], isLoading: monitorsLoading } = useQuery({
    queryKey: ["monitors"],
    queryFn: fetchMonitors,
    refetchInterval: 10000,
  });

  const startMutation = useMutation({
    mutationFn: startMonitor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monitors"] }),
  });

  const stopMutation = useMutation({
    mutationFn: stopMonitor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monitors"] }),
  });

  const activeCount = monitors.filter((m) => m.status === "active").length;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">System Status</h1>
          <p className="text-muted-foreground mt-1">Real-time surveillance overview of Suspicious Activity Detection</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${health?.status === 'ok' ? 'bg-green-500/10 border border-green-500/20 text-green-500' : 'bg-amber-500/10 border border-amber-500/20 text-amber-500'}`}>
            <span className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-green-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`}></span>
            {health?.status === 'ok' ? 'Sensors Online' : 'System Degraded'}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Scans</p>
              <Activity className="w-4 h-4 text-primary" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-3xl font-bold">{stats?.totalDetections || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-destructive uppercase tracking-wider">Anomalies</p>
              <AlertTriangle className="w-4 h-4 text-destructive" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24 bg-destructive/20" />
            ) : (
              <div className="text-3xl font-bold text-destructive">{stats?.suspiciousCount || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Cleared</p>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-3xl font-bold text-green-500">{stats?.normalCount || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Processing</p>
              <Clock className="w-4 h-4 text-amber-500" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-3xl font-bold text-amber-500">{stats?.pendingCount || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Monitors Panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-primary" />
                Live Monitors
              </CardTitle>
              <CardDescription className="mt-1">
                {activeCount > 0
                  ? `${activeCount} stream${activeCount !== 1 ? "s" : ""} actively monitored on the server`
                  : "Background CCTV stream monitors"}
              </CardDescription>
            </div>
            <Link href="/monitors">
              <Button variant="outline" size="sm" className="shrink-0">Manage</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {monitorsLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
              </div>
            ) : monitors.length === 0 ? (
              <div className="h-[260px] flex flex-col items-center justify-center text-muted-foreground border border-dashed rounded-lg">
                <Radio className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium text-foreground">No monitors configured</p>
                <p className="text-sm mt-1 max-w-xs text-center">
                  Add a CCTV stream on the Monitors page to start 24/7 background detection.
                </p>
                <Link href="/monitors" className="mt-4">
                  <Button size="sm">Add Monitor</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {monitors.map((m) => {
                  const isActive = m.status === "active";
                  const isMutating = startMutation.isPending || stopMutation.isPending;
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                        isActive ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/10"
                      }`}
                    >
                      <div className="shrink-0">
                        {isActive ? (
                          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                            <Wifi className="w-5 h-5 text-green-500" />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                            <Radio className="w-5 h-5 text-muted-foreground opacity-50" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-medium text-sm truncate">{m.name}</p>
                          {isActive ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-[10px] gap-1 py-0">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                              LIVE
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">Stopped</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">{m.streamUrl}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{m.whatsappNumber}</span>
                          {m.lastCheckedAt && (
                            <span className="flex items-center gap-1">
                              <Activity className="w-3 h-3" />
                              {new Date(m.lastCheckedAt).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant={isActive ? "outline" : "default"}
                        size="sm"
                        className="shrink-0"
                        disabled={isMutating}
                        onClick={() => isActive ? stopMutation.mutate(m.id) : startMutation.mutate(m.id)}
                      >
                        {isActive
                          ? <><Square className="w-3.5 h-3.5 mr-1.5" />Stop</>
                          : <><Play className="w-3.5 h-3.5 mr-1.5" />Start</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Feed */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Events</CardTitle>
            <CardDescription>Latest system triggers</CardDescription>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-md" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recent && recent.length > 0 ? (
              <div className="space-y-4">
                {recent.map((detection) => (
                  <Link key={detection.id} href={`/detections/${detection.id}`}>
                    <div className="group flex items-start gap-4 p-3 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border cursor-pointer">
                      <div className="w-10 h-10 rounded bg-card border flex items-center justify-center shrink-0">
                        {detection.inputType === 'video' ? (
                          <Video className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ImageIcon className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate capitalize">
                            {detection.activityType || 'Unknown'}
                          </p>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            detection.status === 'suspicious' ? 'bg-destructive/10 text-destructive' :
                            detection.status === 'normal' ? 'bg-green-500/10 text-green-500' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {detection.status}
                          </span>
                        </div>
                        <div className="flex items-center text-xs text-muted-foreground mt-1 gap-2">
                          <span>{new Date(detection.createdAt).toLocaleTimeString()}</span>
                          {detection.confidence && (
                            <>
                              <span>•</span>
                              <span>{(detection.confidence * 100).toFixed(1)}% conf</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
               <div className="py-8 flex flex-col items-center text-center text-muted-foreground">
                 <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                 <p className="text-sm">No recent events in the log</p>
               </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
