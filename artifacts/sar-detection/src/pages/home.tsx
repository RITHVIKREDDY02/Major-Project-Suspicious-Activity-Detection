import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Activity, Shield, ArrowRight, Video, AlertTriangle } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <Activity className="w-6 h-6" />
            <span className="font-bold text-xl tracking-wider text-foreground">Suspicious Activity Detection</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" className="hidden sm:flex">Login</Button>
            </Link>
            <Link href="/register">
              <Button>Create Account</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-20 md:py-32 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background pointer-events-none" />
          <div className="container mx-auto px-4 relative z-10 text-center max-w-4xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-sm font-medium mb-8">
              <Shield className="w-4 h-4" />
              <span>Active Threat Intelligence</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 text-foreground">
              Automated Suspicious Activity Detection
            </h1>
            <p className="text-xl text-muted-foreground mb-10 max-w-3xl mx-auto">
              Real-time AI computer vision (YOLOv8) deployed for live surveillance. Identify theft, violence, and unauthorized access instantly.
            </p>
            <div className="flex items-center justify-center">
              <Link href="/login">
                <Button size="lg" className="h-12 px-8 text-base w-full sm:w-auto">
                  Access Command Center <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Operational Workflow</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">Standard operating procedure for integrating footage with the analysis engine.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
              <div className="hidden md:block absolute top-12 left-[16.66%] right-[16.66%] h-0.5 bg-border z-0"></div>
              
              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-24 h-24 bg-card border-4 border-background rounded-full flex items-center justify-center mb-6 shadow-lg shadow-background/50">
                  <Video className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">1. Ingest</h3>
                <p className="text-muted-foreground">Upload CCTV footage, still images, or connect to RTSP camera streams.</p>
              </div>

              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-24 h-24 bg-card border-4 border-background rounded-full flex items-center justify-center mb-6 shadow-lg shadow-background/50">
                  <Activity className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">2. Analyze</h3>
                <p className="text-muted-foreground">YOLOv8 model processes frames in real time, detecting persons and objects with precision bounding boxes and confidence scores.</p>
              </div>

              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-24 h-24 bg-card border-4 border-background rounded-full flex items-center justify-center mb-6 shadow-lg shadow-background/50">
                  <AlertTriangle className="w-10 h-10 text-destructive" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">3. Alert</h3>
                <p className="text-muted-foreground">Suspicious activities trigger automated alerts with bounding box evidence and confidence scores.</p>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-12">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 text-primary mb-6">
            <Activity className="w-5 h-5" />
            <span className="font-bold tracking-wider text-foreground">Suspicious Activity Detection</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Suspicious Activity Detection System. B.Tech Major Project.
          </p>
        </div>
      </footer>
    </div>
  );
}
