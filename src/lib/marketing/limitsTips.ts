// The explanations Settings -> Marketing -> Consent -> Limits keeps behind an "i" (bpmsquarecore 6b). One place so a
// test holds every text to the InfoTip limit (two sentences, 160 characters). The screen never prints these.

export const LIMITS_TIPS = {
  quiet: "Journey emails wait while it is quiet and go out when it ends. Set both to the same hour for no quiet hours.",
  daysOff: "Journey emails do not go out on these days. They wait for the next day that is allowed.",
  perDay: "The most journey emails one person gets in a day. Further steps wait until a slot frees up.",
  whatsapp: "The most marketing WhatsApp messages one person gets in any 7 days. The next one waits until a slot frees up.",
  timezoneWorkforce: "Quiet hours and days follow the timezone set in Workforce, Attendance rules. Change it there.",
  timezoneDefault: "No timezone is set in Workforce, Attendance rules, so the product default is used. Set it there to change it.",
} as const;
