// Menu values mirror the SharePoint "Curation" list and the Topics sheet.
export const INDUSTRIES = {
  "Contingent Workforce": ["Vendor Management", "MSP (Managed Service Programs)", "Workforce Optimization", "Talent Supply Chain", "Compliance & Risk", "Rate Benchmarking"],
  "Technology and AI": ["Generative AI", "Machine Learning", "Automation & RPA", "Data Engineering", "AI Governance & Ethics", "Cloud Architecture", "Predictive Analytics"],
  "Healthcare": ["Staffing Shortages", "Travel Nursing", "Credentialing & Compliance", "Patient Outcomes Analytics", "Healthcare Workforce Tech", "Value-Based Care"],
  "Legal": ["eDiscovery", "Contract Lifecycle Management (CLM)", "Legal Operations", "Compliance & Regulatory Trends", "AI in Legal", "Litigation Support"],
  "Financial Services": ["Risk Management", "Regulatory Compliance (SEC, FINRA)", "Fraud Detection", "FinTech Innovation", "Wealth Management Tech", "Banking Transformation"],
  "Retail and Consumer": ["Omnichannel Strategy", "Customer Experience (CX)", "Supply Chain Optimization", "Seasonal Staffing", "Personalization & Data", "eCommerce Trends"],
  "Manufacturing": ["Supply Chain Resilience", "Smart Factory / Industry 4.0", "Workforce Automation", "Quality & Compliance", "Procurement Optimization", "ESG in Manufacturing"],
  "Public Sector": ["Government Staffing", "Procurement & RFPs", "Digital Transformation", "Policy & Compliance", "Workforce Modernization", "Grants & Funding"],
};
// The list stores topics as "<prefix> | <topic>"; Contingent Workforce uses "Contingent Staffing".
export const TOPIC_PREFIX = { "Contingent Workforce": "Contingent Staffing" };
export const fullTopic = (industry, topic) => `${TOPIC_PREFIX[industry] || industry} | ${topic}`;
export const AUDIENCES = ["Buyers / Client-Side Decision Makers", "Suppliers / Staffing Firms", "MSP Program Leaders", "VMS Practitioners", "HR / Talent Leaders", "Procurement Leaders"];
export const STYLES = ["Strategic", "Operational", "Tactical", "Executive", "Educational"];
export const RECENCY_MONTHS = [1, 2, 3, 4, 5, 6];

export const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);
export const cfg = () => ({
  port: Number(env("PORT", 3000)),
  production: env("NODE_ENV", "development") === "production",
  baseUrl: env("BASE_URL", `http://localhost:${env("PORT", 3000)}`),
  dbPath: env("DB_PATH", "./data/app.db"),
  sessionSecret: env("SESSION_SECRET", "dev-only-secret-change-me"),
  approvers: env("APPROVERS", "scaruana33@gmail.com,admin@nomorereportsontherun.com,rharrington758@gmail.com").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
  approvalHours: Number(env("APPROVAL_HOURS", 48)),
  mockAgent: env("MOCK_AGENT", "false") === "true",
  anthropicKey: env("ANTHROPIC_API_KEY", ""),
  model: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  smtpUrl: env("SMTP_URL", ""),
  mailFrom: env("MAIL_FROM", "LinkedIn Content Automation <no-reply@localhost>"),
  publishMode: env("PUBLISH_MODE", "dry-run"), // "dry-run" never calls LinkedIn; "live" does
  liToken: env("LINKEDIN_ACCESS_TOKEN", ""),
  liAuthor: env("LINKEDIN_AUTHOR_URN", ""), // e.g. urn:li:person:xxxx
});
