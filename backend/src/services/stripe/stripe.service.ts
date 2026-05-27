import Stripe from 'stripe';
import { config } from '../../config/agent.config.js';
import { logger } from '../../utils/logger.js';

// Initialize Stripe with secret key from environment
const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: '2023-10-16',
});

// Product and pricing configuration
const PRODUCTS = {
  BASIC: {
    id: 'prod_basic',
    name: 'Basic Plan',
    description: 'Essential features for individual users',
    price: 2900, // $29.00 in cents
  },
  PROFESSIONAL: {
    id: 'prod_professional',
    name: 'Professional Plan',
    description: 'Advanced features for growing teams',
    price: 7900, // $79.00 in cents
  },
  ENTERPRISE: {
    id: 'prod_enterprise',
    name: 'Enterprise Plan',
    description: 'Full suite for large organizations',
    price: 19900, // $199.00 in cents
  },
} as const;

/**
 * Create a Stripe customer
 */
export async function createCustomer(params: {
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}) {
  try {
    const customer = await stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata,
    });

    logger.info('Stripe customer created', { customerId: customer.id });
    return customer;
  } catch (error) {
    logger.error('Failed to create Stripe customer', { error });
    throw error;
  }
}

/**
 * Create a Stripe checkout session for one-time purchase
 */
export async function createCheckoutSession(params: {
  customerId: string;
  productKey: keyof typeof PRODUCTS;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}) {
  try {
    const product = PRODUCTS[params.productKey];
    if (!product) {
      throw new Error(`Invalid product key: ${params.productKey}`);
    }

    const session = await stripe.checkout.sessions.create({
      customer: params.customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: product.name,
              description: product.description,
            },
            unit_amount: product.price,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    });

    logger.info('Stripe checkout session created', {
      sessionId: session.id,
      customerId: params.customerId,
      productKey: params.productKey,
    });

    return session;
  } catch (error) {
    logger.error('Failed to create Stripe checkout session', { error });
    throw error;
  }
}

/**
 * Retrieve a checkout session
 */
export async function retrieveCheckoutSession(sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });

    logger.info('Stripe checkout session retrieved', { sessionId });
    return session;
  } catch (error) {
    logger.error('Failed to retrieve Stripe checkout session', { error });
    throw error;
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleWebhookEvent(
  payload: Buffer,
  signature: string
) {
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      config.stripe.webhookSecret
    );

    logger.info('Stripe webhook received', { eventType: event.type });

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    return { received: true };
  } catch (error) {
    logger.error('Failed to handle Stripe webhook', { error });
    throw error;
  }
}

/**
 * Handle successful checkout session
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  logger.info('Checkout session completed', {
    sessionId: session.id,
    customerId: session.customer,
    amountTotal: session.amount_total,
  });

  // Here you would typically:
  // 1. Update your database to mark the purchase as successful
  // 2. Send confirmation email
  // 3. Provision any purchased features/services
  // 4. Update user's subscription/plan status
}

/**
 * Handle successful payment intent
 */
async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent) {
  logger.info('Payment intent succeeded', {
    paymentIntentId: intent.id,
    amount: intent.amount,
    currency: intent.currency,
  });
}

/**
 * Handle failed payment intent
 */
async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent) {
  logger.warn('Payment intent failed', {
    paymentIntentId: intent.id,
    amount: intent.amount,
    currency: intent.currency,
    last_error: intent.last_error,
  });
}

/**
 * Get product information by key
 */
export function getProduct(key: keyof typeof PRODUCTS) {
  return PRODUCTS[key];
}

/**
 * Get all products
 */
export function getAllProducts() {
  return Object.entries(PRODUCTS).map(([key, product]) => ({
    key,
    ...product,
  }));
}

export default {
  createCustomer,
  createCheckoutSession,
  retrieveCheckoutSession,
  handleWebhookEvent,
  getProduct,
  getAllProducts,
};
