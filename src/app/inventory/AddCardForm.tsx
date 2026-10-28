"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useFormStatus } from "react-dom";
import styles from "../admin/admin.module.css";
import CameraAddBox from "./CameraAddBox";
import { cameraAddSdCard } from "./camera-add";
import { addItem, lookupAsset } from "./actions";

type Hubs = {
  hub_id: string;
  name: string;
}[];

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "10px 12px",
};

// Fixed penalty display.
// The server independently calculates the amount before saving.
function penaltyForCapacity(capacity: string): string {
  if (capacity === "256 GB") return "10000";
  if (capacity === "512 GB") return "20000";
  return "";
}

function AddButton({
  lookupBusy,
}: {
  lookupBusy: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={lookupBusy || pending}>
      {pending ? "Saving…" : "Add item"}
    </button>
  );
}

export default function AddCardForm({
  hubs = [],
}: {
  hubs?: Hubs;
}) {
  const hubRef = useRef<HTMLSelectElement>(null);
  const [serial, setSerial] = useState("");
  const [prismNo, setPrismNo] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [cardType, setCardType] = useState("");
  const [sheetDate, setSheetDate] = useState(""); // "Date" from the SD card sheet, display only
  const [condition, setCondition] = useState(""); // "New/Old" from the SD card sheet, display only
  const [note, setNote] = useState("");

  const [lookingUp, setLookingUp] = useState(false);
  const [waitingToLookup, setWaitingToLookup] =
    useState(false);

  const requestId = useRef(0);
  const lastSuccessfulSerial = useRef("");
  const activeLookupSerial = useRef("");

  const lookupTimer = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  const lookupBusy = lookingUp || waitingToLookup;
  const price = penaltyForCapacity(capacity);

  // No Bangalore lookup or automatic hub selection.

  useEffect(() => {
    return () => {
      if (lookupTimer.current !== null) {
        clearTimeout(lookupTimer.current);
        lookupTimer.current = null;
      }

      // Ignore any response arriving after unmount.
      requestId.current += 1;
      activeLookupSerial.current = "";
    };
  }, []);

  function clearDetails() {
    setPrismNo("");
    setBrand("");
    setModel("");
    setCapacity("");
    setCardType("");
    setSheetDate("");
    setCondition("");
  }

  function cancelScheduledLookup() {
    if (lookupTimer.current !== null) {
      clearTimeout(lookupTimer.current);
      lookupTimer.current = null;
    }

    setWaitingToLookup(false);
  }

  function changeSerial(value: string) {
    cancelScheduledLookup();

    // Prevent an old lookup from filling a different serial.
    requestId.current += 1;
    lastSuccessfulSerial.current = "";
    activeLookupSerial.current = "";

    setSerial(value);
    setLookingUp(false);
    clearDetails();
    setNote("");

    const trimmed = value.trim();

    if (!trimmed) return;

    setWaitingToLookup(true);

    // Fetch automatically after typing/scanning pauses.
    lookupTimer.current = setTimeout(() => {
      lookupTimer.current = null;
      void lookup(trimmed);
    }, 600);
  }

  async function lookup(
    value: string,
    force = false
  ) {
    cancelScheduledLookup();

    const trimmed = value.trim();

    if (!trimmed) {
      setNote("Enter or scan an Asset Tag first.");
      return;
    }

    const normalized = trimmed.toLowerCase();

    if (activeLookupSerial.current === normalized) {
      return;
    }

    // Preserve manual edits after a successful lookup.
    // Fetch details can explicitly refresh those values.
    if (
      !force &&
      lastSuccessfulSerial.current === normalized
    ) {
      return;
    }

    const currentRequest = ++requestId.current;
    activeLookupSerial.current = normalized;

    setLookingUp(true);
    setNote("");

    try {
      const found = await lookupAsset(trimmed);

      if (currentRequest !== requestId.current) {
        return;
      }

      if (found && "error" in found) {
        lastSuccessfulSerial.current = "";
        clearDetails();

        setNote(`${found.error} You can enter the details manually meanwhile.`);
        return;
      }

      if (!found) {
        lastSuccessfulSerial.current = "";
        clearDetails();

        setNote(
          "No matching Asset Tag found. Enter the details manually and select storage to calculate the penalty."
        );
        return;
      }

      const foundCapacity =
        found.capacity === "256 GB" ||
        found.capacity === "512 GB"
          ? found.capacity
          : "";

      const foundCardType =
        found.cardType === "Black" ||
        found.cardType === "Green"
          ? found.cardType
          : "";

      setPrismNo(found.prismNo ?? "");
      setBrand(found.brand ?? "");
      setModel(found.model ?? "");
      setCapacity(foundCapacity);
      setCardType(foundCardType);
      setSheetDate(found.date ?? "");
      setCondition(found.condition ?? "");

      lastSuccessfulSerial.current = normalized;

      const missing: string[] = [];

      if (!found.prismNo) missing.push("Prism number");
      if (!found.brand) missing.push("brand");
      if (!found.model) missing.push("model");
      if (!foundCapacity) missing.push("storage");
      if (!foundCardType) missing.push("card colour");

      setNote(
        missing.length
          ? `Asset found. Missing details: ${missing.join(
              ", "
            )}. Enter these manually. Penalty is calculated from storage.`
          : "Card details loaded. Choose the home hub and review the details before saving."
      );
    } catch {
      if (currentRequest !== requestId.current) {
        return;
      }

      lastSuccessfulSerial.current = "";
      clearDetails();

      setNote(
        "Could not load the asset sheet. Retry with Fetch details or enter the details manually."
      );
    } finally {
      if (currentRequest === requestId.current) {
        activeLookupSerial.current = "";
        setLookingUp(false);
      }
    }
  }

  return (
    <form
      action={addItem}
      aria-label="Add inventory item"
      onSubmit={(event) => {
        // Block submissions while lookup is queued or running.
        if (
          lookupTimer.current !== null ||
          activeLookupSerial.current ||
          lookupBusy
        ) {
          event.preventDefault();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={fieldStyle}>
          <label style={fieldStyle}>
            <span>Serial / Asset Tag *</span>

            <input
              name="itemId"
              placeholder="Scan or type — details load automatically"
              value={serial}
              onChange={(event) =>
                changeSerial(event.target.value)
              }
              onBlur={(event) => {
                if (event.currentTarget.value.trim()) {
                  void lookup(event.currentTarget.value);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void lookup(event.currentTarget.value);
                }
              }}
              autoComplete="off"
              spellCheck={false}
              required
              style={inputStyle}
            />
          </label>
          <CameraAddBox
            onOpen={() => hubRef.current?.reportValidity() ?? false}
            save={(code) => cameraAddSdCard(code, hubRef.current?.value ?? "")}
          />
        </div>

        {/* Home hub is mandatory. No default hub is selected. */}
        <label style={fieldStyle}>
          <span>Home hub *</span>

          <select
            ref={hubRef}
            name="homeHub"
            defaultValue=""
            required
            style={inputStyle}
          >
            <option value="" disabled>
              Select home hub
            </option>

            {(hubs ?? []).map((hub) => (
              <option
                key={hub.hub_id}
                value={hub.hub_id}
              >
                {hub.name}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldStyle}>
          <span>Prism number</span>

          <input
            name="prismNo"
            placeholder="Prism number"
            value={prismNo}
            onChange={(event) =>
              setPrismNo(event.target.value)
            }
            readOnly={lookupBusy}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span>Brand</span>

          <input
            name="brand"
            placeholder="Brand"
            value={brand}
            onChange={(event) =>
              setBrand(event.target.value)
            }
            readOnly={lookupBusy}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span>Model</span>

          <input
            name="model"
            placeholder="Model"
            value={model}
            onChange={(event) =>
              setModel(event.target.value)
            }
            readOnly={lookupBusy}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span>Storage of card *</span>

          <select
            name="capacity"
            value={capacity}
            onChange={(event) =>
              setCapacity(event.target.value)
            }
            disabled={lookupBusy}
            required
            style={inputStyle}
          >
            <option value="">Select storage</option>
            <option value="256 GB">256 GB</option>
            <option value="512 GB">512 GB</option>
          </select>
        </label>

        <label style={fieldStyle}>
          <span>Type of card / colour</span>

          <select
            name="cardType"
            value={cardType}
            onChange={(event) =>
              setCardType(event.target.value)
            }
            disabled={lookupBusy}
            style={inputStyle}
          >
            <option value="">Select card type</option>
            <option value="Black">Black</option>
            <option value="Green">Green</option>
          </select>
        </label>

        <label style={fieldStyle}>
          <span>Date (from sheet)</span>
          <input value={sheetDate} placeholder="Loads from the sheet" readOnly style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>New / Old</span>
          <input value={condition} placeholder="Loads from the sheet" readOnly style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Penalty amount (₹)</span>

          <input
            name="price"
            type="number"
            value={price}
            placeholder="Calculated from storage"
            readOnly
            style={inputStyle}
          />

          <small className={styles.muted}>
            256 GB: ₹10,000 · 512 GB: ₹20,000
          </small>
        </label>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          disabled={lookingUp || !serial.trim()}
          onClick={() => {
            void lookup(serial, true);
          }}
        >
          {lookingUp ? "Fetching…" : "Fetch details"}
        </button>

        <AddButton lookupBusy={lookupBusy} />
      </div>

      <p
        className={styles.muted}
        role="status"
        aria-live="polite"
        style={{ margin: 0 }}
      >
        {lookingUp
          ? "Looking up card details…"
          : waitingToLookup
            ? "Waiting for typing or scanning to finish…"
            : note ||
              "Enter an Asset Tag. Details load automatically. Review the card details before saving."}
      </p>
    </form>
  );
}