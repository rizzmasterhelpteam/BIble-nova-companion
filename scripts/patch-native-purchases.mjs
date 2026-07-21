import fs from "node:fs";
import path from "node:path";

const pluginPath = path.resolve(
  process.cwd(),
  "node_modules",
  "@capgo",
  "native-purchases",
  "android",
  "src",
  "main",
  "java",
  "ee",
  "forgr",
  "nativepurchases",
  "NativePurchasesPlugin.java",
);

if (!fs.existsSync(pluginPath)) {
  console.warn("Native purchases Android source is not installed; skipping offer patch.");
  process.exit(0);
}

let source = fs.readFileSync(pluginPath, "utf8");
let changed = false;

const offerDeclaration = '        String offerId = call.getString("offerId");';
if (!source.includes(offerDeclaration)) {
  const planDeclaration = '        String planIdentifier = call.getString("planIdentifier");';
  if (!source.includes(planDeclaration)) {
    throw new Error("Could not find the native purchases plan identifier declaration.");
  }
  source = source.replace(planDeclaration, `${planDeclaration}\n${offerDeclaration}`);
  changed = true;
}

const basePlanSelection = `                                    if (offerDetails.getBasePlanId().equals(planIdentifier)) {
                                        selectedOfferDetails = offerDetails;
                                        Log.d(TAG, "Found matching plan: " + planIdentifier);
                                        break;
                                    }`;
const offerSelection = `                                    if (
                                        offerDetails.getBasePlanId().equals(planIdentifier) &&
                                        (offerId == null || offerId.isEmpty() || offerId.equals(offerDetails.getOfferId()))
                                    ) {
                                        selectedOfferDetails = offerDetails;
                                        Log.d(TAG, "Found matching plan/offer: " + planIdentifier + "/" + offerId);
                                        break;
                                    }`;
if (!source.includes("offerDetails.getOfferId()))")) {
  if (!source.includes(basePlanSelection)) {
    throw new Error("Could not find the native purchases offer selection block.");
  }
  source = source.replace(basePlanSelection, offerSelection);
  changed = true;
}

const basePlanFallback = `                                if (selectedOfferDetails == null) {
                                    selectedOfferDetails = productDetailsItem.getSubscriptionOfferDetails().get(0);
                                    Log.d(TAG, "Using first available offer: " + selectedOfferDetails.getBasePlanId());
                                }`;
const offerFallback = `                                if (selectedOfferDetails == null && offerId != null && !offerId.isEmpty()) {
                                    closeBillingClient();
                                    call.reject("Subscription offer not found: " + offerId);
                                    return;
                                }
                                if (selectedOfferDetails == null) {
                                    selectedOfferDetails = productDetailsItem.getSubscriptionOfferDetails().get(0);
                                    Log.d(TAG, "Using first available offer: " + selectedOfferDetails.getBasePlanId());
                                }`;
if (!source.includes("Subscription offer not found:")) {
  if (!source.includes(basePlanFallback)) {
    throw new Error("Could not find the native purchases offer fallback block.");
  }
  source = source.replace(basePlanFallback, offerFallback);
  changed = true;
}

if (changed) {
  fs.writeFileSync(pluginPath, source);
  console.info("Patched @capgo/native-purchases to honor Android offer IDs.");
}
