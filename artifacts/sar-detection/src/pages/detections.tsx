import { useListDetections } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter, AlertTriangle, ShieldCheck, Clock, ArrowRight } from "lucide-react";
import { useState } from "react";

export default function Detections() {
  const [filterType, setFilterType] = useState<string>("all");
  const { data: detections, isLoading } = useListDetections(
    filterType !== "all" ? { activityType: filterType } : undefined
  );

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">Detection Log</h1>
          <p className="text-muted-foreground mt-1">Historical archive of all system scans</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-card/50">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search logs..." className="pl-9 bg-background" />
          </div>
          <div className="w-full sm:w-[200px] flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="normal">Normal (Safe)</SelectItem>
                <SelectItem value="suspicious">Suspicious</SelectItem>
                <SelectItem value="theft">Theft</SelectItem>
                <SelectItem value="violence">Violence</SelectItem>
                <SelectItem value="loitering">Loitering</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-0 flex flex-col sm:flex-row items-center">
                <Skeleton className="w-full sm:w-48 h-32 rounded-none" />
                <div className="p-6 flex-1 space-y-3 w-full">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : detections && detections.length > 0 ? (
          detections.map((detection) => {
            const isSuspicious = detection.status === "suspicious" || (detection.activityType && detection.activityType !== "normal");
            const date = new Date(detection.createdAt);
            
            return (
              <Card key={detection.id} className="overflow-hidden group hover:border-primary/50 transition-colors">
                <Link href={`/detections/${detection.id}`}>
                  <div className="flex flex-col sm:flex-row cursor-pointer">
                    
                    {/* Thumbnail */}
                    <div className="w-full sm:w-48 h-32 bg-muted relative shrink-0 border-r border-border flex items-center justify-center overflow-hidden">
                      {detection.inputUrl ? (
                        <img
                          src={detection.inputUrl}
                          alt={detection.activityType ?? "detection"}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          {isSuspicious ? (
                            <AlertTriangle className="w-8 h-8 text-destructive opacity-70" />
                          ) : (
                            <ShieldCheck className="w-8 h-8 text-green-500 opacity-70" />
                          )}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors pointer-events-none" />
                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 text-[10px] font-mono text-white rounded">
                        {detection.inputType.toUpperCase()}
                      </div>
                    </div>

                    {/* Details */}
                    <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between min-w-0">
                      <div className="flex justify-between items-start mb-2 gap-4">
                        <div className="min-w-0">
                          <h3 className="font-bold text-lg flex items-center gap-2 truncate">
                            <span className="capitalize">{detection.activityType || "Unknown"}</span>
                            {isSuspicious && <Badge variant="destructive" className="uppercase text-[10px] tracking-wider px-1.5 py-0">Alert</Badge>}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate font-mono mt-1">
                            ID: {detection.id.toString().padStart(5, '0')} | {detection.inputFilename || detection.inputUrl || "Direct Upload"}
                          </p>
                        </div>
                        <Badge variant="outline" className={
                          detection.status === 'suspicious' ? "bg-destructive/10 text-destructive border-destructive/20" :
                          detection.status === 'normal' ? "bg-green-500/10 text-green-500 border-green-500/20" : ""
                        }>
                          {detection.status.toUpperCase()}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between mt-4 text-sm">
                        <div className="flex items-center gap-4 text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" />
                            {date.toLocaleDateString()} {date.toLocaleTimeString()}
                          </span>
                          {detection.confidence && (
                            <span className="font-mono">
                              Conf: {(detection.confidence * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors transform group-hover:translate-x-1" />
                      </div>
                    </div>

                  </div>
                </Link>
              </Card>
            );
          })
        ) : (
          <div className="text-center py-20 bg-card rounded-lg border border-border border-dashed">
            <ShieldCheck className="w-12 h-12 text-muted-foreground opacity-50 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-foreground">No logs found</h3>
            <p className="text-muted-foreground mt-2">Adjust filters or run a new scan.</p>
          </div>
        )}
      </div>
    </div>
  );
}
