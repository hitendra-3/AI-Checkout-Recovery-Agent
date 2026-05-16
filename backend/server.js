require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('🚀 Pragya API is running...');
});


process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promise Rejection at:', promise, 'reason:', reason);
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getAiDecision(prompt, model) {
  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    if (!result || !result.response) {
      console.error("AI Response is empty or invalid:", result);
      return null;
    }

    const responseText = result.response.text().trim();
    const finishReason = result.response.candidates?.[0]?.finishReason;
    console.log("AI Finish Reason:", finishReason);
    console.log("AI Response Text:", responseText);

    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      console.error("Failed to parse AI JSON directly:", parseError);

      let fixedText = responseText;
      if (!fixedText.endsWith('}')) {
        if ((fixedText.match(/"/g) || []).length % 2 !== 0) {
          fixedText += '"';
        }
        fixedText += "\n  },\n  \"suggested_action\": null\n}";
      }

      try {
        const salvaged = JSON.parse(fixedText);
        console.log("Successfully salvaged truncated JSON!");
        return salvaged;
      } catch (e) {
        console.error("Could not salvage JSON.");
        const firstBrace = responseText.indexOf('{');
        const lastBrace = responseText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && firstBrace !== lastBrace) {
          try {
            return JSON.parse(responseText.substring(firstBrace, lastBrace + 1));
          } catch (e2) {
            console.error("Markdown fallback failed.");
          }
        }
        return {
          confidence: 1.0,
          reasoning: "Internal parsing error fallback",
          intent: "error",
          strategy: "fallback",
          response: "I'm having a little trouble connecting right now, but I'm here to help. Could you please repeat that?",
          suggested_action: null
        };
      }
    }
  } catch (e) {
    console.error("AI Generation failed. Error details:", {
      message: e.message,
      stack: e.stack,
      status: e.status,
      statusText: e.statusText
    });
  }
  return null;
}

app.post('/api/recover', async (req, res) => {
  try {
    const {
      cart_total,
      items,
      shipping_cost,
      shipping_type,
      user_message,
      chat_history,
      event,
      idle_time,
      user_typing,
      search_history
    } = req.body;

    let intervention_triggered = false;
    if (event === 'user_enquiry' || (idle_time >= 20 && !user_typing)) intervention_triggered = true;

    if (!intervention_triggered) {
      return res.json({ intervention_triggered: false });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.json({ intent: "error", response: "⚠️ AI Key Missing", intervention_triggered: true });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const freeShippingThreshold = 1500;
    const gap = freeShippingThreshold - (cart_total || 0);
    const amount_needed = gap > 0 ? gap : 0;

    let suggestedAddon;
    const cartItemsStr = JSON.stringify(items).toLowerCase();

    if (cartItemsStr.includes("mug") || cartItemsStr.includes("cup")) {
      suggestedAddon = { name: "Coaster Set (Set of 4)", price: 150 };
    } else if (cartItemsStr.includes("tee") || cartItemsStr.includes("shirt") || cartItemsStr.includes("clothing")) {
      suggestedAddon = { name: "Premium Cotton Socks", price: 199 };
    } else {
      suggestedAddon = { name: "Premium Leather Card Holder", price: 399 };
    }

    const currentUserMessage = user_message || "NO MESSAGE";

    const storeContext = {
      shipping_policy: "Free shipping above ₹1500. Standard delivery in 3–5 days.",
      return_policy: "7-day return available for unused products."
    };

    const context = {
      cart_total: cart_total || 0,
      items: items || [],
      shipping_cost: shipping_cost || 0,
      shipping_type: shipping_type || "standard",
      amount_needed,
      suggestedAddon,
      user_message: currentUserMessage,
      chat_history: chat_history || [],
      search_history: search_history || [],
      storeContext
    };

    const prompt = `
You are Pragya Store Assistant, a professional e-commerce checkout assistant. When greeting the user for the first time, introduce yourself as the Pragya Store Assistant.

You help users complete their purchase by resolving hesitation.

---

## STORE CONTEXT

Shipping Policy: ${context.storeContext.shipping_policy}
Return Policy: ${context.storeContext.return_policy}

---

## USER CONTEXT

Cart Total: ₹${context.cart_total}
Shipping Cost: ₹${context.shipping_cost}
Shipping Type Selected: ${context.shipping_type}
Amount needed for free shipping: ₹${context.amount_needed}
Items in Cart: ${JSON.stringify(context.items)}
Search History: ${JSON.stringify(context.search_history)}
Recent Chat History: ${JSON.stringify(context.chat_history)}

User Message: "${context.user_message}"

---

## YOUR TASK

1. Understand the user's intent
2. Identify what is stopping checkout
3. Use store policies to answer correctly
4. Suggest helpful action if needed

---

## RULES

- Be short (max 2 sentences)
- Adopt a premium, high-end brand tone (Shopify-level). Be warm, confident, and sophisticated.
- Use previous chat history to maintain continuity and avoid repeating answers
- Do NOT make up policies
- Use only given context
- If unsure, say: "Let me check that for you"

---

## SPECIAL BEHAVIOR

- If the user is idle ("NO MESSAGE") and amount_needed > 0, start with a soft question to see if they need help, then optionally mention they are close to free shipping. (e.g., "Need help with anything? You're also quite close to free shipping.")
- If user explicitly asks about shipping OR hesitates about price, AND they are close to free shipping (amount_needed <= ₹300) → Suggest a relevant add-on product based on cart context that helps unlock free shipping. You may use this example as guidance: ${JSON.stringify(context.suggestedAddon)}.
- Only suggest an add-on when it makes sense to unlock free shipping.
- If strategy is "no_intervention", return a very short neutral response or empty string and do NOT push any suggestion.
- If user asks about quality → confidently assure them of our premium materials and craftsmanship.
- If user asks about shipping → base your answer on whether they selected standard or express delivery.
- If price concern → explain value.
- If delivery question → use shipping policy.
- If return question → use return policy.
- If the user's message is gibberish or unclear (e.g. "asdfgh", "???") → politely ask for clarification.

---

## OUTPUT (STRICT JSON)

Ensure the output is 100% valid JSON. Set suggested_action to null if no product suggestion is needed.
If you suggest an add-on, use this exact object instead of null, ensuring you use the provided example product price: { "type": "add_product", "reason": "free_shipping", "product": { "name": "...", "price": 123 } }
Also include a confidence score (0-1) for your decision.

{
  "confidence": 0.85,
  "reasoning": "short explanation of why this response was chosen",
  "intent": "string",
  "strategy": "string or 'no_intervention'",
  "response": "string",
  "suggested_action": null
}
`;

    let aiDecision = await getAiDecision(prompt, model);

    if (!aiDecision) {
      return res.status(500).json({ intent: "error", response: "⚠️ AI generation failed", intervention_triggered: true });
    }

    aiDecision.intervention_triggered = aiDecision.strategy !== 'no_intervention';
    return res.json(aiDecision);

  } catch (error) {
    res.status(500).json({ intent: "error", response: "⚠️ Error", intervention_triggered: true });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server is listening on port ${PORT}`);
  console.log('Press Ctrl+C to stop');
});

setInterval(() => { }, 1000000);
