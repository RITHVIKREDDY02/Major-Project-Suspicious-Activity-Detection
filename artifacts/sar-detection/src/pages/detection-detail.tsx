import { useParams, Link, useLocation } from "wouter";
import { useGetDetection, useDeleteDetection, getGetDetectionQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Clock, FileType, Activity, Trash2, ShieldAlert, CheckCircle, ScanLine } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function DetectionDetail() {
  const { id } = useParams();
  const numericId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: detection, isLoading } = useGetDetection(numericId, {
    query: { enabled: !!numericId, queryKey: getGetDetectionQueryKey(numericId) }
  });

  const deleteMutation = useDeleteDetection();

  const handleDelete = () => {
    deleteMutation.mutate({ id: numericId }, {
      onSuccess: () => {
        toast({ title: "Record Expunged", description: "Detection data permanently removed." });
        setLocation("/detections");
      },
      onError: (err) => {
        toast({ title: "Error", description: err.error || "Failed to delete", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="w-32 h-10" />
        <Skeleton className="w-full h-[400px] rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!detection) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Record Not Found</h2>
        <Link href="/detections"><Button className="mt-4">Return to Logs</Button></Link>
      </div>
    );
  }

  const isSuspicious = detection.status === "suspicious";
  const date = new Date(detection.createdAt);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <Link href="/detections">
          <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Logs
          </Button>
        </Link>
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="hidden sm:flex">
              <Trash2 className="w-4 h-4 mr-2" /> Expunge Record
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the surveillance record and remove the data from our servers.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Main Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className="font-mono bg-card text-muted-foreground">ID: {detection.id.toString().padStart(5, '0')}</Badge>
            <Badge className={
              isSuspicious ? "bg-destructive/10 text-destructive border-destructive hover:bg-destructive/20" : 
              "bg-green-500/10 text-green-500 border-green-500 hover:bg-green-500/20"
            }>
              {detection.status.toUpperCase()}
            </Badge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight capitalize bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
            {detection.activityType || "Unclassified Activity"}
          </h1>
        </div>
        <div className="text-right flex flex-col md:items-end">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Clock className="w-4 h-4" />
            <span>{date.toLocaleDateString()} {date.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* Visualizer */}
      <Card className="overflow-hidden border-border bg-black/40">
        <div className="relative aspect-video w-full flex items-center justify-center border-b border-border shadow-inner group">

          {/* Background: real image or dark placeholder */}
          {detection.inputUrl ? (
            detection.inputType === "video" ? (
              <video
                src={detection.inputUrl}
                className="absolute inset-0 w-full h-full object-cover"
                muted
                loop
                autoPlay
                playsInline
              />
            ) : (
              <img
                src={detection.inputUrl}
                alt={detection.activityType ?? "detection"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )
          ) : (
            <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center opacity-50">
              <ScanLine className="w-24 h-24 text-primary/10" />
              <svg viewBox="0 0 100 100" className="absolute w-full h-full text-zinc-800" fill="none">
                <rect x="0" y="0" width="100" height="100" stroke="currentColor" strokeWidth="1" strokeDasharray="2 8"/>
              </svg>
            </div>
          )}

          {/* Bounding boxes overlay */}
          {(() => {
            type BBoxItem = { x: number; y: number; width: number; height: number; label: string; confidence: number };
            let boxes: BBoxItem[] = [];
            if (detection.boundingBoxes) {
              try { boxes = JSON.parse(detection.boundingBoxes) as BBoxItem[]; } catch { boxes = []; }
            }
            if (boxes.length === 0) {
              const fallbackStyle = isSuspicious
                ? { top: '25%', left: '35%', width: '30%', height: '50%' }
                : { top: '30%', left: '40%', width: '20%', height: '60%' };
              return (
                <div
                  className={`absolute border-2 border-dashed ${isSuspicious ? 'border-destructive bg-destructive/10 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'border-green-500 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.5)]'} transition-all`}
                  style={fallbackStyle}
                >
                  <div className={`absolute top-0 left-0 -translate-y-full ${isSuspicious ? 'bg-destructive text-destructive-foreground' : 'bg-green-500 text-white'} px-2 py-1 text-xs font-mono font-bold whitespace-nowrap z-10`}>
                    {isSuspicious ? (detection.activityType?.toUpperCase() ?? 'SUSPICIOUS') : 'PERSON'} {detection.confidence ? `${(detection.confidence * 100).toFixed(1)}%` : ''}
                  </div>
                </div>
              );
            }
            return (
              <>
                {boxes.map((box, i) => {
                  const isAlert = box.label !== "normal" && box.label !== "person";
                  const borderColor = isAlert ? '#ef4444' : isSuspicious ? '#ef4444' : '#22c55e';
                  return (
                    <div key={i} className="absolute border-2"
                      style={{ top: `${box.y}%`, left: `${box.x}%`, width: `${box.width}%`, height: `${box.height}%`, borderColor, borderStyle: 'solid' }}>
                      <div className="absolute top-0 left-0 -translate-y-full px-1.5 py-0.5 text-[10px] font-mono font-bold whitespace-nowrap z-10"
                        style={{ backgroundColor: borderColor, color: '#fff' }}>
                        {box.label.toUpperCase()} {(box.confidence * 100).toFixed(0)}%
                      </div>
                      <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2" style={{ borderColor }} />
                      <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2" style={{ borderColor }} />
                      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2" style={{ borderColor }} />
                      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2" style={{ borderColor }} />
                    </div>
                  );
                })}
              </>
            );
          })()}

          {/* HUD overlays */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none z-10">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-mono text-white drop-shadow bg-black/60 px-1.5 py-0.5 rounded">
              {detection.inputType.toUpperCase()} ANALYSIS
            </span>
          </div>
          <div className="absolute top-2 right-2 pointer-events-none z-10">
            <span className="text-xs font-mono text-zinc-300 bg-black/60 px-2 py-0.5 rounded">
              YOLOv8
            </span>
          </div>
        </div>
      </Card>

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Analysis Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg border border-border">
                <p className="text-sm text-muted-foreground mb-1">Model Conf. Score</p>
                <p className="text-2xl font-mono font-bold">
                  {detection.confidence ? `${(detection.confidence * 100).toFixed(2)}%` : "N/A"}
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg border border-border">
                <p className="text-sm text-muted-foreground mb-1">Threat Level</p>
                <div className="flex items-center gap-2">
                  {isSuspicious ? (
                    <><ShieldAlert className="w-6 h-6 text-destructive" /><span className="text-xl font-bold text-destructive">ELEVATED</span></>
                  ) : (
                    <><CheckCircle className="w-6 h-6 text-green-500" /><span className="text-xl font-bold text-green-500">NOMINAL</span></>
                  )}
                </div>
              </div>
            </div>
            
            <div className="pt-4 border-t border-border">
               <h4 className="text-sm font-semibold mb-2">Raw Output (JSON)</h4>
               <div className="bg-black/50 p-3 rounded font-mono text-xs text-muted-foreground overflow-auto max-h-32">
                 {detection.boundingBoxes ? detection.boundingBoxes : "[]"}
               </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileType className="w-5 h-5 text-primary" /> Source Metadata
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-[100px_1fr] gap-2 py-2 border-b border-border">
              <span className="text-muted-foreground font-medium">Type</span>
              <span className="capitalize">{detection.inputType}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 py-2 border-b border-border">
              <span className="text-muted-foreground font-medium">Source</span>
              <span className="truncate" title={detection.inputUrl || detection.inputFilename || "N/A"}>
                {detection.inputUrl || detection.inputFilename || "N/A"}
              </span>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 py-2 border-b border-border">
              <span className="text-muted-foreground font-medium">Logged By</span>
              <span>Operator ID: {detection.userId || 'SYSTEM'}</span>
            </div>
            
            <div className="pt-2">
              <span className="text-muted-foreground font-medium block mb-2">Operator Notes</span>
              <p className="p-3 bg-muted/30 rounded-md min-h-20 italic">
                {detection.notes || "No context notes provided."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
