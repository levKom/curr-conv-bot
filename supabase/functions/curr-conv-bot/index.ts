import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// import cc from "npm:currency-codes@2.1.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Bot,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.30.0/mod.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// import { Hono } from "jsr:@hono/hono";
// const functionName = "curr-conv-bot";
// const app = new Hono().basePath(`/${functionName}`);

const RATES_TABLE = "currency_rates";

const supabaseUrl = Deno.env.get("PUBLIC_SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("PUBLIC_SUPABASE_ANON_KEY") || "";
const tgToken = Deno.env.get("TG_TOKEN") || "";
const publicSecret = Deno.env.get("SECRET") || "";
const fxRatesKey = Deno.env.get("FX_RATES_KEY") || "";

const EUR = ["eur", "euro", "євро", "євр", "еуро"];
const USD = ["usd", "us", "юсд"];
const UAH = ["uah", "юах", "грн", "гривень"];
const CAD = ["cad", "кад"];
const CZK = ["czk", "цзк"];

const convertToCurrencyMap = (currencyName, currencyArray) => {
  return currencyArray.reduce((acc, curr) => {
    acc[curr.toUpperCase()] = currencyName;
    return acc;
  }, {});
};

const CURRENCY_MAP = {
  ...convertToCurrencyMap("EUR", EUR),
  ...convertToCurrencyMap("USD", USD),
  ...convertToCurrencyMap("UAH", UAH),
  ...convertToCurrencyMap("CAD", CAD),
  ...convertToCurrencyMap("CZK", CZK),
};

const supabase = createClient(supabaseUrl, supabaseKey);

const bot = new Bot(tgToken);

const lessThanWeekAgo = (date) => {
  const now = Date.now();
  const dayInMs = 1000 * 60 * 60 * 24 * 7;
  const dateTime = new Date(date).getTime();

  return now - dateTime < dayInMs;
};

const getLastCurrencyUpdateDate = async () => {
  try {
    const { data: dates } = await supabase
      .from(RATES_TABLE)
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);

    const lastDate = dates[0];

    if (lastDate) {
      return new Date(lastDate.created_at);
    } else {
      return new Date(null);
    }
  } catch (e) {
    return new Date(null);
  }
};

const getLastCurrencyUpdateDateForBase = async (base) => {
  try {
    const { data: dates } = await supabase
      .from(RATES_TABLE)
      .select("created_at", "base")
      .eq("base", base)
      .order("created_at", { ascending: false })
      .limit(1);

    const lastDate = dates[0];

    if (lastDate) {
      return new Date(lastDate.created_at);
    } else {
      return new Date(null);
    }
  } catch (e) {
    return new Date(null);
  }
};

const getCurrencyExchangeRates = async (base) => {
  try {
    const { data: allRates } = await supabase
      .from(RATES_TABLE)
      .select("rates", "base")
      .eq("base", base)
      .order("created_at", { ascending: false })
      .limit(1);

    const currentRates = allRates[0].rates;

    return currentRates;
  } catch (e) {
    throw new Error(e.message);
  }
};

const SEPARATORS = ["🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇"];

const fetchRates = async (base) => {
  try {
    const currencies = ["USD", "CZK", "UAH", "CAD", "EUR"]
      .filter((curr) => curr !== base)
      .join(",");
    const searchParams = new URLSearchParams({
      currencies: "PRESERVE_COMMAS",
      base: base || "EUR",
      places: 3,
    })
      .toString()
      .replace("PRESERVE_COMMAS", currencies);

    const response = await fetch(
      `https://api.fxratesapi.com/latest?${searchParams}`,
      {
        headers: { Authorization: `Bearer ${fxRatesKey}` },
      },
    );

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }
    const json = await response.json();

    return json;
  } catch (e) {
    throw new Error(e.message);
  }
};

const fetchCurrencyExchangeRates = async (userRequestBase) => {
  try {
    const { rates, base } = await fetchRates(userRequestBase);

    const { data, error } = await supabase
      .from(RATES_TABLE)
      .insert({ rates, base })
      .select("rates");

    if (error) {
      throw new Error(`Supabase failed to insert data: ${error.message}`);
    }

    return data.rates;
  } catch (e) {
    throw new Error(e.message);
  }
};

bot.on(":text", async (ctx) => {
  const normalizedMessage = ctx.msg.text.toUpperCase().replace(/\W+/g, "");

  const match = normalizedMessage.match(/^(\d+)(\D+)$/);

  if (match) {
    const amount = parseInt(match[1], 10);
    const currency = match[2];

    const base = CURRENCY_MAP[currency];

    if (base) {
      const lastCurrencyUpdateDate =
        await getLastCurrencyUpdateDateForBase(base);
      let rates;
      if (lessThanWeekAgo(lastCurrencyUpdateDate)) {
        rates = await getCurrencyExchangeRates(base);
      } else {
        rates = await fetchCurrencyExchangeRates(base);
      }

      const convertedAmount = Object.entries(rates).reduce(
        (acc, [curr, rate], index) => {
          acc += `${(amount * rate).toLocaleString()} ${curr} ${SEPARATORS[index]} `;
          return acc;
        },
        "",
      );

      ctx.reply(convertedAmount.slice(0, -3));
    }
  }
});

const useWebhook = webhookCallback(bot, "std/http");

const run = async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") !== publicSecret) {
      return new Response("Not allowed", { status: 405 });
    }

    return await useWebhook(req.clone());
  } catch (e) {
    console.error(e);
  }
};

serve(run);
