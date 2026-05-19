import { type Request, type Response } from 'express';
import { contactStore, messageStore } from '../services/store.js';
import type { ContactType, ContactStage, Contact } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Shared contact CRUD helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/contacts */
export const listContacts = (req: Request, res: Response) => {
  const { type, stage, search, page = '1', pageSize = '20' } = req.query;
  const contacts = contactStore.list({
    type: type as ContactType | undefined,
    stage: stage as ContactStage | undefined,
    search: search as string | undefined,
  });
  const pg = Math.max(1, parseInt(String(page), 10) || 1);
  const ps = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
  const start = (pg - 1) * ps;
  const sliced = contacts.slice(start, start + ps);
  res.json({
    data: sliced,
    total: contacts.length,
    page: pg,
    pageSize: ps,
  });
};

/** GET /api/contacts/:id */
export const getContact = (req: Request, res: Response) => {
  const contact = contactStore.get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  res.json(contact);
};

/** POST /api/contacts */
export const createContact = (req: Request, res: Response) => {
  const { type, name, email, phone, company, title, stage, notes } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const contact = contactStore.create({
    type: type || 'prospect',
    name,
    email,
    phone,
    company,
    title,
    stage: stage || 'new',
    notes,
  });
  res.status(201).json(contact);
};

/** POST /api/contacts/bulk */
export const bulkCreateContacts = (req: Request, res: Response) => {
  const { contacts } = req.body;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts array is required and must not be empty' });
  }
  // Filter to only valid contacts (must have email)
  const valid = contacts.filter((c: any) => c.email);
  if (valid.length === 0) {
    return res.status(400).json({ error: 'No valid contacts — email is required' });
  }
  const inputs = valid.map((c: any) => ({
    type: c.type || 'prospect',
    name: c.name || '',
    email: c.email,
    phone: c.phone || undefined,
    company: c.company || undefined,
    title: c.title || undefined,
    stage: c.stage || 'new',
    notes: c.notes || undefined,
    outreach_status: c.outreach_status || 'none',
    emails_sent: c.emails_sent || 0,
    last_contacted: c.last_contacted || undefined,
  }));
  const created = contactStore.bulkCreate(inputs);
  res.status(201).json({ success: true, imported: created.length, contacts: created });
};

/** PUT /api/contacts/:id */
export const updateContact = (req: Request, res: Response) => {
  const updated = contactStore.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Contact not found' });
  res.json(updated);
};

/** DELETE /api/contacts/:id */
export const deleteContact = (req: Request, res: Response) => {
  if (contactStore.delete(req.params.id)) {
    res.status(204).send();
  } else {
    res.status(404).json({ error: 'Contact not found' });
  }
};

/** GET /api/contacts/pipeline/stages */
export const getPipeline = (_req: Request, res: Response) => {
  res.json(contactStore.pipeline());
};

// ═══════════════════════════════════════════════════════════════════════════════
// Contact messages
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/contacts/:id/messages */
export const getContactMessages = (req: Request, res: Response) => {
  const msgs = messageStore.forContact(req.params.id);
  res.json({ data: msgs, total: msgs.length });
};

/** POST /api/contacts/:id/messages */
export const addContactMessage = (req: Request, res: Response) => {
  const { content, channel, direction, subject, status } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const msg = messageStore.add({
    contactId: req.params.id,
    content,
    channel: channel || 'email',
    direction: direction || 'outbound',
    subject,
    status: status || 'sent',
  });
  res.status(201).json(msg);
};
