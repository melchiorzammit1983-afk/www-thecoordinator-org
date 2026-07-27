/** Lightweight inline i18n for the crew portal (matches the LANGS pattern used in routes/auth.tsx). */

export type CrewLang = "en" | "fil";

export const CREW_LANGS: Record<CrewLang, Record<string, string>> = {
  en: {
    lang_name: "English",
    welcome: "Welcome, {{name}}",
    login_title: "Crew check-in",
    login_subtitle: "Enter your email to get a one-time code.",
    email_label: "Your email",
    send_code: "Send code",
    code_title: "Enter your code",
    code_subtitle: "We emailed a 6-digit code to {{email}}.",
    code_label: "6-digit code",
    verify: "Verify",
    resend_code: "Resend code",
    wrong_code: "Incorrect or expired code — please try again.",
    your_itinerary: "Your flight itinerary",
    leg_1: "Leg 1",
    leg_2: "Leg 2",
    leg_3: "Leg 3",
    update_status: "Update your status",
    not_yet_departed: "Not yet departed",
    boarding: "Boarding",
    boarded: "Boarded",
    landed: "Landed",
    missed_connection: "Missed connection",
    delayed: "Delayed",
    arrived: "Arrived",
    expected_arrival_malta: "Expected arrival in Malta",
    pickup_driver: "Your pickup driver",
    pickup_driver_pending: "Your driver hasn't been assigned yet",
    car: "Car",
    plate: "License plate",
    status_updated: "Status updated",
    no_itinerary: "No itinerary on file yet — check back soon.",
    link_invalid: "This link is not valid. Please contact your coordinator.",
    sign_out: "Sign out",
  },
  fil: {
    lang_name: "Filipino",
    welcome: "Maligayang pagdating, {{name}}",
    login_title: "Crew check-in",
    login_subtitle: "Ilagay ang iyong email para makakuha ng one-time code.",
    email_label: "Iyong email",
    send_code: "Ipadala ang code",
    code_title: "Ilagay ang iyong code",
    code_subtitle: "Nagpadala kami ng 6-digit code sa {{email}}.",
    code_label: "6-digit code",
    verify: "I-verify",
    resend_code: "Ipadala ulit ang code",
    wrong_code: "Maling o expired na code — subukan ulit.",
    your_itinerary: "Ang iyong itinerary ng flight",
    leg_1: "Leg 1",
    leg_2: "Leg 2",
    leg_3: "Leg 3",
    update_status: "I-update ang iyong status",
    not_yet_departed: "Hindi pa umaalis",
    boarding: "Boarding",
    boarded: "Nakasakay na",
    landed: "Dumating na (lupa)",
    missed_connection: "Na-miss ang connection",
    delayed: "Na-delay",
    arrived: "Dumating na",
    expected_arrival_malta: "Inaasahang pagdating sa Malta",
    pickup_driver: "Ang iyong driver",
    pickup_driver_pending: "Wala pang na-assign na driver",
    car: "Sasakyan",
    plate: "Plate number",
    status_updated: "Na-update ang status",
    no_itinerary: "Wala pang itinerary — balikan mamaya.",
    link_invalid: "Hindi valid ang link na ito. Makipag-ugnayan sa iyong coordinator.",
    sign_out: "Mag-sign out",
  },
};

export function crewT(lang: CrewLang, key: string, vars?: Record<string, string>): string {
  const dict = CREW_LANGS[lang] ?? CREW_LANGS.en;
  let str = dict[key] ?? CREW_LANGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replace(`{{${k}}}`, v);
  }
  return str;
}
