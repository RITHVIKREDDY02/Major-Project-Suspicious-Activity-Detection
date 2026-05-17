import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { User, Lock, MessageSquare, CheckCircle2, Eye, EyeOff, Send } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TwilioInfo = {
  accountSid: string;
  authToken: string;
  whatsappFrom: string;
  whatsappTo: string;
  phoneFrom: string;
  alertTo: string;
  configured: boolean;
};

type TelegramInfo = {
  botToken: string;
  chatId: string;
  configured: boolean;
};

type Profile = {
  id: number;
  username: string;
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  createdAt: string;
  twilio: TwilioInfo;
  telegram: TelegramInfo;
};

async function apiFetch(path: string, options?: RequestInit) {
  const r = await fetch(`${BASE}/api${path}`, { credentials: "include", ...options });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return r.json();
}

type Section = "profile" | "password" | "twilio" | "telegram";

export default function MyAccount() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useState<Section>("profile");

  const emptyTwilio: TwilioInfo = { accountSid: "", authToken: "", whatsappFrom: "", whatsappTo: "", phoneFrom: "", alertTo: "", configured: false };
  const emptyTelegram: TelegramInfo = { botToken: "", chatId: "", configured: false };

  const { data: profile, isLoading } = useQuery<Profile>({
    queryKey: ["account", "profile"],
    queryFn: () => apiFetch("/account/profile"),
    staleTime: 30 * 1000,
    initialData: user
      ? {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName ?? null,
          isAdmin: user.isAdmin ?? false,
          createdAt: user.createdAt,
          twilio: emptyTwilio,
          telegram: emptyTelegram,
        }
      : undefined,
  });

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioWhatsappFrom, setTwilioWhatsappFrom] = useState("");
  const [twilioWhatsappTo, setTwilioWhatsappTo] = useState("");
  const [twilioPhoneFrom, setTwilioPhoneFrom] = useState("");
  const [twilioAlertTo, setTwilioAlertTo] = useState("");

  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName ?? "");
      setUsername(profile.username);
    }
  }, [profile]);

  const profileMutation = useMutation({
    mutationFn: () =>
      apiFetch("/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, username }),
      }),
    onSuccess: (data: Profile) => {
      setUser({ ...user!, ...data });
      qc.invalidateQueries({ queryKey: ["account"] });
      toast({ title: "Profile updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const passwordMutation = useMutation({
    mutationFn: () =>
      apiFetch("/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password changed successfully" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const twilioMutation = useMutation({
    mutationFn: () =>
      apiFetch("/account/twilio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSid: twilioSid,
          authToken: twilioToken,
          whatsappFrom: twilioWhatsappFrom,
          whatsappTo: twilioWhatsappTo,
          phoneFrom: twilioPhoneFrom,
          alertTo: twilioAlertTo,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account"] });
      toast({ title: "WhatsApp settings saved" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const telegramMutation = useMutation({
    mutationFn: () =>
      apiFetch("/account/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: telegramBotToken, chatId: telegramChatId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account"] });
      toast({ title: "Telegram settings saved" });
      setTelegramBotToken("");
      setTelegramChatId("");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handlePasswordSave = () => {
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    passwordMutation.mutate();
  };

  const sections = [
    { id: "profile" as Section, label: "Profile", icon: User },
    { id: "password" as Section, label: "Password", icon: Lock },
    { id: "twilio" as Section, label: "WhatsApp", icon: MessageSquare },
    { id: "telegram" as Section, label: "Telegram", icon: Send },
  ];

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-6">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xl shrink-0">
          {profile?.username?.substring(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{profile?.fullName || profile?.username}</h1>
          <p className="text-muted-foreground text-sm">{profile?.email}</p>
        </div>
      </div>

      {/* Section Nav */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-lg w-fit">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeSection === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Profile Section */}
      {activeSection === "profile" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4" /> Profile Information
            </CardTitle>
            <CardDescription>Update your display name and username</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Display Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-7"
                  placeholder="username"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <Input value={profile?.email ?? ""} disabled className="opacity-60 cursor-not-allowed" />
              <p className="text-xs text-muted-foreground">Email cannot be changed</p>
            </div>
            <Button
              onClick={() => profileMutation.mutate()}
              disabled={profileMutation.isPending}
              className="w-full"
            >
              {profileMutation.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Password Section */}
      {activeSection === "password" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="w-4 h-4" /> Change Password
            </CardTitle>
            <CardDescription>Keep your account secure with a strong password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPw ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw(!showCurrentPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPw ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(!showNewPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Minimum 6 characters</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            <Button
              onClick={handlePasswordSave}
              disabled={passwordMutation.isPending || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
              className="w-full"
              variant="outline"
            >
              {passwordMutation.isPending ? "Changing..." : "Change Password"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* WhatsApp / Twilio Section */}
      {activeSection === "twilio" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> WhatsApp Alert Configuration
                  </CardTitle>
                  <CardDescription>Connect your Twilio account to receive WhatsApp alerts when suspicious activity is detected</CardDescription>
                </div>
                {profile?.twilio.configured && (
                  <Badge className="shrink-0 bg-green-500/15 text-green-400 border-green-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />Connected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-1 text-sm">
                <p className="font-medium text-foreground">How to get your Twilio credentials:</p>
                <ol className="text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Sign up at <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">twilio.com</span></li>
                  <li>Copy Account SID and Auth Token from the Console dashboard</li>
                  <li>Enable WhatsApp Sandbox: Messaging → Try it out → Send a WhatsApp message</li>
                  <li>Have your recipient send the sandbox join code to <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">+14155238886</span></li>
                </ol>
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Twilio Credentials</p>
                <div className="space-y-1.5">
                  <Label>Account SID</Label>
                  <Input
                    value={twilioSid}
                    onChange={(e) => setTwilioSid(e.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Auth Token</Label>
                  <Input
                    type="password"
                    value={twilioToken}
                    onChange={(e) => setTwilioToken(e.target.value)}
                    placeholder="Your Twilio Auth Token"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Stored securely — shown masked after saving</p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">WhatsApp Numbers</p>
                <div className="space-y-1.5">
                  <Label>Send From (WhatsApp Number)</Label>
                  <Input
                    value={twilioWhatsappFrom}
                    onChange={(e) => setTwilioWhatsappFrom(e.target.value)}
                    placeholder="whatsapp:+14155238886"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Default Twilio sandbox: whatsapp:+14155238886</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Send Alerts To (Your Number)</Label>
                  <Input
                    value={twilioWhatsappTo}
                    onChange={(e) => setTwilioWhatsappTo(e.target.value)}
                    placeholder="whatsapp:+91XXXXXXXXXX"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Your WhatsApp number with country code</p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Voice Call Alerts (Optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Call From</Label>
                    <Input
                      value={twilioPhoneFrom}
                      onChange={(e) => setTwilioPhoneFrom(e.target.value)}
                      placeholder="+1XXXXXXXXXX"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Call To</Label>
                    <Input
                      value={twilioAlertTo}
                      onChange={(e) => setTwilioAlertTo(e.target.value)}
                      placeholder="+91XXXXXXXXXX"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              <Button
                onClick={() => twilioMutation.mutate()}
                disabled={twilioMutation.isPending}
                className="w-full"
              >
                {twilioMutation.isPending ? "Saving..." : "Save WhatsApp Settings"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Telegram Section */}
      {activeSection === "telegram" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Send className="w-4 h-4" /> Telegram Bot Configuration
                  </CardTitle>
                  <CardDescription>Receive instant Telegram alerts when suspicious activity is detected</CardDescription>
                </div>
                {profile?.telegram.configured && (
                  <Badge className="shrink-0 bg-green-500/15 text-green-400 border-green-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />Connected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-1 text-sm">
                <p className="font-medium text-foreground">How to set up your Telegram bot:</p>
                <ol className="text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Open Telegram and search for <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">@BotFather</span></li>
                  <li>Send <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">/newbot</span> and follow the prompts to create a bot</li>
                  <li>Copy the Bot Token provided by BotFather</li>
                  <li>Start a chat with your bot, then open <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">api.telegram.org/bot&lt;token&gt;/getUpdates</span> to find your Chat ID</li>
                </ol>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Bot Token</Label>
                  <Input
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder="123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {profile?.telegram.configured ? "Bot token already saved — enter a new one to replace it" : "Stored securely — shown masked after saving"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Chat ID</Label>
                  <Input
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="-100XXXXXXXXXX or your numeric chat ID"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Your personal chat ID or a group/channel ID</p>
                </div>
              </div>

              <Button
                onClick={() => telegramMutation.mutate()}
                disabled={telegramMutation.isPending}
                className="w-full"
              >
                {telegramMutation.isPending ? "Saving..." : "Save Telegram Settings"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
