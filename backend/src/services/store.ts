import { v4 as uuidv4 } from 'uuid';
import type { Contact, ContactType, ContactStage, Message, Product } from '../types/index.js';

// ── In-Memory Storage ──────────────────────────────────────────────────────────

interface Store {
  contacts: Map<string, Contact>;
  messages: Map<string, Message>;
  products: Map<string, Product>;
  metrics: {
    totalContacts: number;
    activeContacts: number;
    emailsSent: number;
    emailsOpened: number;
    emailsReplied: number;
    meetingsScheduled: number;
    conversions: number;
    productsScraped: number;
    lastScrapedAt: string | null;
    scrapeStatus: string;
  };
  outreachStats: { triggered: number; paused: number; resumed: number };
  followupStats: { triggered: number; cancelled: number };
  meetingStats: { suggested: number; confirmed: number; remindersSent: number };
  emailSentToday: number;
  emailLogs: EmailLogEntry[];
}

const store: Store = {
  contacts: new Map(),
  messages: new Map(),
  products: new Map(),
  metrics: {
    totalContacts: 0,
    activeContacts: 0,
    emailsSent: 0,
    emailsOpened: 0,
    emailsReplied: 0,
    meetingsScheduled: 0,
    conversions: 0,
    productsScraped: 0,
    lastScrapedAt: null,
    scrapeStatus: 'idle',
  },
  outreachStats: { triggered: 0, paused: 0, resumed: 0 },
  followupStats: { triggered: 0, cancelled: 0 },
  meetingStats: { suggested: 0, confirmed: 0, remindersSent: 0 },
  emailSentToday: 0,
  emailLogs: [],
};

// ── Seed Data ──────────────────────────────────────────────────────────────────

const seedContacts: Contact[] = [
  {
    id: uuidv4(),
    type: 'prospect',
    persona: 'b2b_customer',
    name: 'James Wanjiku',
    email: 'james.wanjiku@example.co.ke',
    phone: '+254 700 111 222',
    company: 'Nairobi Builders Ltd',
    title: 'Procurement Manager',
    stage: 'engaged',
    status: 'researched',
    lastContactDate: new Date(Date.now() - 2 * 86400000).toISOString(),
    nextFollowupDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    notes: 'Interested in excavator financing for Q3 expansion.',
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: uuidv4(),
    type: 'investor',
    persona: 'investor',
    name: 'Aisha Omondi',
    email: 'aisha@eastafricacapital.com',
    phone: '+254 722 333 444',
    company: 'East Africa Capital Partners',
    title: 'Investment Director',
    stage: 'qualified',
    status: 'researched',
    lastContactDate: new Date(Date.now() - 5 * 86400000).toISOString(),
    nextFollowupDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    notes: 'Series A investor. Requested full financial projections.',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: uuidv4(),
    type: 'partner',
    persona: 'procurement_manager',
    name: 'David Mensah',
    email: 'd.mensah@westafricadistributors.com',
    company: 'West Africa Distributors',
    title: 'Regional Sales Head',
    stage: 'contacted',
    status: 'new',
    notes: 'Potential distribution partner across 5 W/A markets.',
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: uuidv4(),
    type: 'prospect',
    persona: 'b2b_customer',
    name: 'Fatima Nkosi',
    email: 'fatima.n@tanzaniaconstruction.co.tz',
    company: 'Tanzania Construction Co',
    title: 'CEO',
    stage: 'new',
    status: 'new',
    notes: 'Referral from Nairobi Builders. High-value prospect.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: uuidv4(),
    type: 'investor',
    persona: 'investor',
    name: 'Samuel Okonkwo',
    email: 'samuel@greenfundafrica.com',
    company: 'GreenFund Africa',
    title: 'Managing Partner',
    stage: 'qualified',
    status: 'researched',
    notes: 'Impact investor focused on sustainable infrastructure.',
    createdAt: new Date(Date.now() - 21 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
];

seedContacts.forEach((c) => store.contacts.set(c.id, c));
store.metrics.totalContacts = seedContacts.length;
store.metrics.activeContacts = seedContacts.filter(
  (c) => c.stage === 'engaged' || c.stage === 'qualified'
).length;

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ListOptions {
  type?: ContactType;
  stage?: ContactStage;
  search?: string;
}

export const contactStore = {
  /** Return ALL contacts. */
  list(opts: ListOptions = {}): Contact[] {
    let items = Array.from(store.contacts.values());
    if (opts.type) items = items.filter((c) => c.type === opts.type);
    if (opts.stage) items = items.filter((c) => c.stage === opts.stage);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      items = items.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.company?.toLowerCase().includes(q)
      );
    }
    return items.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  },

  /** Return one contact by id. */
  get(id: string): Contact | undefined {
    return store.contacts.get(id);
  },

  /** Create a new contact. */
  create(input: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Contact {
    const id = uuidv4();
    const now = new Date().toISOString();
    const contact: Contact = { ...input, id, createdAt: now, updatedAt: now };
    store.contacts.set(id, contact);
    store.metrics.totalContacts++;
    return contact;
  },

  /** Update an existing contact (partial). */
  update(id: string, patch: Partial<Contact>): Contact | undefined {
    const existing = store.contacts.get(id);
    if (!existing) return undefined;
    const updated: Contact = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    store.contacts.set(id, updated);
    return updated;
  },

  /** Delete a contact. */
  delete(id: string): boolean {
    const existed = store.contacts.delete(id);
    if (existed) store.metrics.totalContacts = Math.max(0, store.metrics.totalContacts - 1);
    return existed;
  },

  /** Stages pipeline aggregated counts. */
  pipeline(): Record<ContactStage, number> {
    const counts: Record<string, number> = {
      new: 0, contacted: 0, engaged: 0, qualified: 0, converted: 0, lost: 0,
    };
    store.contacts.forEach((c) => counts[c.stage]++);
    return counts as Record<ContactStage, number>;
  },
};

export const messageStore = {
  forContact(contactId: string): Message[] {
    return Array.from(store.messages.values())
      .filter((m) => m.contactId === contactId)
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
  },

  add(input: Omit<Message, 'id' | 'sentAt'>): Message {
    const msg: Message = {
      ...input,
      id: uuidv4(),
      sentAt: new Date().toISOString(),
    };
    store.messages.set(msg.id, msg);
    return msg;
  },
};

export const metricsStore = {
  get(): Store['metrics'] {
    return { ...store.metrics };
  },
};

export const outreachStore = {
  trigger(): Record<string, number> {
    store.outreachStats.triggered++;
    store.metrics.emailsSent += 3;
    store.emailSentToday += 3;
    return { ...store.outreachStats };
  },
  pause(): Record<string, number> {
    store.outreachStats.paused++;
    return { ...store.outreachStats };
  },
  resume(): Record<string, number> {
    store.outreachStats.resumed++;
    return { ...store.outreachStats };
  },
  stats(): typeof store.outreachStats {
    return { ...store.outreachStats };
  },
};

export const followupStore = {
  trigger(): Record<string, number> {
    store.followupStats.triggered++;
    store.metrics.activeContacts = Math.max(0, store.metrics.activeContacts + 1);
    return { ...store.followupStats };
  },
  cancel(): Record<string, number> {
    store.followupStats.cancelled++;
    store.metrics.activeContacts = Math.max(0, store.metrics.activeContacts - 1);
    return { ...store.followupStats };
  },
  stats(): typeof store.followupStats {
    return { ...store.followupStats };
  },
};

export const meetingStore = {
  suggest(): Record<string, number> {
    store.meetingStats.suggested++;
    return { ...store.meetingStats };
  },
  confirm(): Record<string, number> {
    store.meetingStats.confirmed++;
    store.metrics.meetingsScheduled++;
    return { ...store.meetingStats };
  },
  remind(): Record<string, number> {
    store.meetingStats.remindersSent++;
    return { ...store.meetingStats };
  },
  stats(): typeof store.meetingStats {
    return { ...store.meetingStats };
  },
};

export const rateLimitStore = {
  emailRemaining(configLimit: number): number {
    return Math.max(0, configLimit - store.emailSentToday);
  },
};

// ─── Product Store ─────────────────────────────────────────────────────────────

export interface ProductListOptions {
  category?: string;
  inStock?: boolean;
  search?: string;
}

export const productStore = {
  list(opts: ProductListOptions = {}): Product[] {
    let items = Array.from(store.products.values());
    if (opts.category) items = items.filter((p) => p.category.toLowerCase().includes(opts.category!.toLowerCase()));
    if (opts.inStock !== undefined) items = items.filter((p) => p.inStock === opts.inStock);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    return items.sort(
      (a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime(),
    );
  },

  get(id: string): Product | undefined {
    return store.products.get(id);
  },

  add(product: Product): Product {
    store.products.set(product.id, product);
    return product;
  },

  addMany(products: Product[]): Product[] {
    products.forEach((p) => store.products.set(p.id, p));
    return products;
  },

  delete(id: string): boolean {
    return store.products.delete(id);
  },

  clear(): void {
    store.products.clear();
  },

  count(): number {
    return store.products.size;
  },
};

// ── Email Logs ──────────────────────────────────────────────────────────────────

export interface EmailLogEntry {
  id:          string;
  contactId:   string;
  contactName: string;
  to:          string;
  subject:     string;
  body:        string;
  status:      'sent' | 'failed';
  error?:      string;
  sentAt:      string;
}

export const emailLogsStore = {
  list(): EmailLogEntry[] {
    return [...store.emailLogs].reverse();
  },
  add(entry: Omit<EmailLogEntry, 'id' | 'sentAt'>): EmailLogEntry {
    const log: EmailLogEntry = { ...entry, id: uuidv4(), sentAt: new Date().toISOString() };
    store.emailLogs.push(log);
    return log;
  },
};

// Made with Bob
