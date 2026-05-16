import { useState, useEffect, useRef, useCallback } from "react";
import { CheckoutHeader } from "./CheckoutHeader";
import { CheckoutForm } from "./CheckoutForm";
import { OrderSummary, Product } from "./OrderSummary";
import { CheckoutFooter } from "./CheckoutFooter";
import { PaymentSuccess } from "./PaymentSuccess";
import { ChatWidget } from "./ChatWidget";
import mugImg from "@/assets/product-mug.jpg";
import tshirtImg from "@/assets/product-tshirt.jpg";

const initialProducts: Product[] = [
  {
    id: 1,
    name: "Classic Ceramic Mug",
    variant: "White / 12oz",
    price: 399.0,
    qty: 1,
    image: mugImg,
  },
  {
    id: 2,
    name: "Essential Cotton Tee",
    variant: "Black / Medium",
    price: 499.0,
    qty: 2,
    image: tshirtImg,
  },
];

interface ChatMessage {
  id: string;
  role: "ai" | "user";
  text: string;
  action?: {
    type: string;
    product?: {
      name: string;
      price: number;
    };
  } | null;
}

export const CheckoutPage = () => {
  const [success, setSuccess] = useState<{ email: string } | null>(null);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  
  const [idleTime, setIdleTime] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [lastInterventionTime, setLastInterventionTime] = useState(0);
  
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [shippingType, setShippingType] = useState<"standard" | "express">("standard");
  
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cartTotal = products.reduce((sum, p) => sum + p.price * p.qty, 0);
  const freeShippingThreshold = 1500;
  
  const getShippingCost = () => {
    if (shippingType === "express") {
      return cartTotal >= 1500 ? 0 : 30;
    }
    return cartTotal >= 1500 ? 0 : 15;
  };
  
  const shippingCost = getShippingCost();

  const handleTyping = useCallback(() => {
    setIsTyping(true);
    setIdleTime(0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2000);
  }, []);

  const resetIdle = useCallback(() => {
    setIdleTime(0);
  }, []);

  useEffect(() => {
    idleTimerRef.current = setInterval(() => {
      setIdleTime((prev) => prev + 1);
    }, 1000);

    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
    };
  }, [resetIdle]);

  useEffect(() => {
    const checkHesitation = async () => {
      const now = Date.now();
      if (isChatOpen || (now - lastInterventionTime < 60000)) return;
      
      let score = 0;
      if (idleTime >= 20) score += 1;
      if (!isTyping && idleTime > 5) score += 1;
      if (idleTime >= 20) score += 1;

      if (score >= 2) {
        setLastInterventionTime(Date.now());
        try {
          const response = await fetch("https://ai-checkout-recovery-agent.onrender.com/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cart_total: cartTotal,
              items: products,
              shipping_cost: shippingCost,
              shipping_type: shippingType,
              user_message: "",
              event: "checkout_hesitation",
              idle_time: idleTime,
              user_typing: isTyping,
              search_history: ["premium leather wallet", "minimalist watch", "organic cotton socks"]
            })
          });
          const data = await response.json();
          if (data.intervention_triggered) {
            let cleanResponse = data.response;
            if (cleanResponse && cleanResponse.length > 500) {
              cleanResponse = "⚠️ AI has reached its daily limit. Please try again later.";
            }
            setChatMessages(prev => [
              ...prev,
              {
                id: Date.now().toString(),
                role: "ai",
                text: cleanResponse || "I'm here to help you complete your order.",
                action: data.suggested_action
              }
            ]);
            setIsChatOpen(true);
          }
        } catch (error) {
          console.error("Failed to fetch AI recovery:", error);
        }
      }
    };

    checkHesitation();
  }, [idleTime, isTyping, cartTotal, products, isChatOpen, lastInterventionTime]);

  const handleSendMessage = async (message: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      text: message
    };
    setChatMessages(prev => [...prev, userMessage]);
    setIsAiTyping(true);

    try {
      const response = await fetch("https://ai-checkout-recovery-agent.onrender.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_total: cartTotal,
          items: products,
          shipping_cost: shippingCost,
          shipping_type: shippingType,
          user_message: message,
          chat_history: chatMessages.map(m => ({ role: m.role, text: m.text })).slice(-5),
          event: "user_enquiry",
          idle_time: 0,
          user_typing: true,
          search_history: ["premium leather wallet", "minimalist watch", "organic cotton socks"]
        })
      });
      const data = await response.json();
      
      let cleanResponse = data.response || "I'm here to help you complete your order.";
      if (cleanResponse.length > 500) {
        cleanResponse = "⚠️ AI has reached its daily limit. Please try again later.";
      }

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        text: cleanResponse,
        action: data.suggested_action
      };
      
      setChatMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error("Failed to send message:", error);
      setChatMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "ai",
          text: "Sorry, I'm having trouble connecting right now. Let me know if you need any other help."
        }
      ]);
    } finally {
      setIsAiTyping(false);
    }
  };

  const handleAddSuggestedProduct = (product: { name: string; price: number }) => {
    setProducts(prev => [
      ...prev,
      {
        id: Date.now(),
        name: product.name,
        variant: "One Size",
        price: product.price,
        qty: 1,
        image: mugImg,
      }
    ]);
    
    const newCartTotal = cartTotal + product.price;
    if (newCartTotal >= freeShippingThreshold && cartTotal < freeShippingThreshold) {
      setChatMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "ai",
          text: "There you go! You just unlocked free shipping for your order 🎉"
        }
      ]);
      setIsChatOpen(true);
    }
  };

  if (success) {
    return (
      <PaymentSuccess
        email={success.email}
        total={cartTotal}
        products={products}
        onContinue={() => setSuccess(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="lg:hidden border-b border-[hsl(var(--checkout-divider))] bg-white">
        <div className="px-5 py-4">
          <h1 className="text-[20px] font-medium text-[hsl(var(--checkout-text))]">
            Pragya Store
          </h1>
        </div>
      </div>

      <div className="lg:flex lg:flex-row-reverse lg:min-h-screen">
        <aside className="lg:w-1/2 xl:w-[46%] bg-[hsl(var(--checkout-summary-bg))] lg:border-l border-[hsl(var(--checkout-summary-border))]">
          <div className="lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto">
            <div className="lg:max-w-[480px] lg:ml-0 lg:mr-auto lg:pl-12 xl:pl-20 lg:pr-8 px-5 py-6 lg:py-12">
              <OrderSummary products={products} shippingCost={shippingCost} />
            </div>
          </div>
        </aside>

        <main className="lg:w-1/2 xl:w-[54%]">
          <div className="lg:max-w-[560px] lg:ml-auto lg:mr-0 lg:pr-12 xl:pr-20 lg:pl-8 px-5 py-6 lg:py-10">
            <CheckoutHeader />
            <CheckoutForm 
              onSuccess={(email) => setSuccess({ email })} 
              onTyping={handleTyping} 
              shippingCost={shippingCost} 
              onShippingTypeChange={(type) => setShippingType(type)}
            />
            <CheckoutFooter />
          </div>
        </main>
      </div>

      <ChatWidget
        messages={chatMessages}
        isOpen={isChatOpen}
        setIsOpen={setIsChatOpen}
        onSendMessage={handleSendMessage}
        onAddProduct={handleAddSuggestedProduct}
        isLoading={isAiTyping}
      />
    </div>
  );
};
