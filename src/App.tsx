import { useState } from "react";
import {
  Aptos,
  AptosConfig,
  Deserializer,
  Network,
  SimpleTransaction,
  type AnyRawTransaction,
} from "@aptos-labs/ts-sdk";
import { WalletSelector } from "@aptos-labs/wallet-adapter-ant-design";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
const RECIPIENT = "0x1";
const AMOUNT_OCTA = 100;
const EXPLORER_BASE = "https://explorer.aptoslabs.com/txn";

type TxResult = {
  status: "idle" | "submitting" | "success" | "error";
  buildMode?: "payload" | "builtRawTx";
  mode?: "normal" | "withFeePayer";
  method?: "signAndSubmit" | "signThenSubmit";
  hash?: string;
  explorerUrl?: string;
  errorText?: string;
  errorRaw?: unknown;
};

type BuildSummary = {
  sender: string;
  recipient: string;
  amount: number;
  withFeePayer: boolean;
  txType?: string;
  serializedBytes?: number;
};

function shortAddress(value?: string | null): string {
  if (!value) return "-";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function normalizeError(err: unknown): { text: string; raw: unknown } {
  if (typeof err === "string") {
    return { text: err, raw: err };
  }

  if (err instanceof Error) {
    const extra = err as Error & { code?: string | number; data?: unknown };
    const text = [
      extra.name && `name=${extra.name}`,
      extra.message && `message=${extra.message}`,
      extra.code !== undefined && `code=${String(extra.code)}`,
    ]
      .filter(Boolean)
      .join(" | ");
    return { text: text || "Unknown wallet error", raw: extra };
  }

  if (typeof err === "object" && err !== null) {
    const anyErr = err as Record<string, unknown>;
    const text = [
      anyErr.name ? `name=${String(anyErr.name)}` : "",
      anyErr.message ? `message=${String(anyErr.message)}` : "",
      anyErr.code !== undefined ? `code=${String(anyErr.code)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    return { text: text || "Unknown wallet error", raw: anyErr };
  }

  return { text: "Unknown wallet error", raw: err };
}

export default function App() {
  const { account, connected, network, wallet, signAndSubmitTransaction, signTransaction, submitTransaction } =
    useWallet();
  const [txResult, setTxResult] = useState<TxResult>({ status: "idle" });
  const [lastBuildSummary, setLastBuildSummary] = useState<BuildSummary | null>(null);

  const networkName = network?.name ?? "unknown";
  const accountAddress = account?.address?.toString();

  const buildTransferTx = async ({
    sender,
    recipient,
    amount,
    withFeePayer,
  }: {
    sender: string;
    recipient: string;
    amount: number;
    withFeePayer: boolean;
  }): Promise<AnyRawTransaction> => {
    return aptos.transaction.build.simple({
      sender,
      data: {
        function: "0x1::aptos_account::transfer_coins",
        typeArguments: ["0x1::aptos_coin::AptosCoin"],
        functionArguments: [recipient, amount],
      },
      withFeePayer,
    });
  };

  const runTx = async ({
    withFeePayer,
    method,
  }: {
    withFeePayer: boolean;
    method: "signAndSubmit" | "signThenSubmit";
  }) => {
    const mode = withFeePayer ? "withFeePayer" : "normal";
    const buildMode = method === "signAndSubmit" ? "payload" : "builtRawTx";
    if (!connected || !accountAddress) {
      setTxResult({
        status: "error",
        buildMode,
        mode,
        method,
        errorText: "Wallet not connected. Please connect Petra first.",
        errorRaw: null,
      });
      return;
    }

    if (networkName.toLowerCase() !== "testnet") {
      setTxResult({
        status: "error",
        buildMode,
        mode,
        method,
        errorText: `Network mismatch: wallet=${networkName}. Please switch to testnet in Petra.`,
        errorRaw: network,
      });
      return;
    }

    setLastBuildSummary({
      sender: accountAddress,
      recipient: RECIPIENT,
      amount: AMOUNT_OCTA,
      withFeePayer,
    });
    setTxResult({ status: "submitting", buildMode, mode, method });

    try {
      const transactionInput: Parameters<typeof signAndSubmitTransaction>[0] = {
        sender: accountAddress,
        data: {
          function: "0x1::aptos_account::transfer_coins",
          typeArguments: ["0x1::aptos_coin::AptosCoin"],
          functionArguments: [RECIPIENT, AMOUNT_OCTA],
        },
        withFeePayer,
      };

      let hash: string;
      if (method === "signAndSubmit") {
        const response = await signAndSubmitTransaction(transactionInput);
        hash = response.hash;
      } else {
        const builtTx = await buildTransferTx({
          sender: accountAddress,
          recipient: RECIPIENT,
          amount: AMOUNT_OCTA,
          withFeePayer,
        });
        const signed = await signTransaction({
          transactionOrPayload:
            builtTx as unknown as Parameters<typeof signTransaction>[0]["transactionOrPayload"],
        });

        const rawBytes = signed.rawTransaction.byteLength;
        const rawTxn = SimpleTransaction.deserialize(
          new Deserializer(signed.rawTransaction),
        ) as unknown as Parameters<typeof submitTransaction>[0]["transaction"];
        const submitted = await submitTransaction({
          transaction: rawTxn,
          senderAuthenticator:
            signed.authenticator as Parameters<typeof submitTransaction>[0]["senderAuthenticator"],
        });
        hash = submitted.hash;

        setLastBuildSummary({
          sender: accountAddress,
          recipient: RECIPIENT,
          amount: AMOUNT_OCTA,
          withFeePayer,
          txType: builtTx.constructor.name,
          serializedBytes: rawBytes,
        });
      }

      await aptos.waitForTransaction({ transactionHash: hash });

      setTxResult({
        status: "success",
        buildMode,
        mode,
        method,
        hash,
        explorerUrl: `${EXPLORER_BASE}/${hash}?network=testnet`,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      setTxResult({
        status: "error",
        buildMode,
        mode,
        method,
        errorText: normalized.text,
        errorRaw: {
          context: {
            withFeePayer,
            method,
            buildMode,
            walletName: wallet?.name ?? null,
            network: networkName,
            sender: accountAddress,
            recipient: RECIPIENT,
            amount: AMOUNT_OCTA,
          },
          raw: normalized.raw,
        },
      });
    }
  };

  return (
    <main className="page">
      <h1>Petra signAndSubmitTransaction Repro (Testnet)</h1>

      <section className="card">
        <WalletSelector />
        <div className="actions">
          <button
            className="send-btn"
            onClick={() => runTx({ withFeePayer: false, method: "signAndSubmit" })}
            disabled={txResult.status === "submitting"}
          >
            Normal + SignAndSubmit
          </button>
          <button
            className="send-btn"
            onClick={() => runTx({ withFeePayer: true, method: "signAndSubmit" })}
            disabled={txResult.status === "submitting"}
          >
            FeePayer + SignAndSubmit
          </button>
          <button
            className="send-btn"
            onClick={() => runTx({ withFeePayer: false, method: "signThenSubmit" })}
            disabled={txResult.status === "submitting"}
          >
            Normal + SignThenSubmit
          </button>
          <button
            className="send-btn"
            onClick={() => runTx({ withFeePayer: true, method: "signThenSubmit" })}
            disabled={txResult.status === "submitting"}
          >
            FeePayer + SignThenSubmit
          </button>
        </div>
      </section>

      <section className="card debug">
        <h2>Debug Info</h2>
        <p>
          <strong>Wallet:</strong> {wallet?.name ?? "-"}
        </p>
        <p>
          <strong>Address:</strong> {shortAddress(accountAddress)}
        </p>
        <p>
          <strong>Network:</strong> {networkName}
        </p>
        <pre>{JSON.stringify(lastBuildSummary, null, 2)}</pre>
      </section>

      <section className="card result">
        <h2>Result</h2>
        <p>
          <strong>Status:</strong> {txResult.status}
        </p>
        <p>
          <strong>BuildMode:</strong> {txResult.buildMode ?? "-"}
        </p>
        <p>
          <strong>Mode:</strong> {txResult.mode ?? "-"}
        </p>
        <p>
          <strong>Method:</strong> {txResult.method ?? "-"}
        </p>

        {txResult.hash && (
          <p>
            <strong>Hash:</strong> {txResult.hash}
          </p>
        )}

        {txResult.explorerUrl && (
          <p>
            <a href={txResult.explorerUrl} target="_blank" rel="noreferrer">
              Open in Aptos Explorer (testnet)
            </a>
          </p>
        )}

        {txResult.errorText && (
          <p className="error">
            <strong>Error:</strong> {txResult.errorText}
          </p>
        )}

        {txResult.errorRaw !== undefined && (
          <details>
            <summary>Raw Error</summary>
            <pre>{JSON.stringify(txResult.errorRaw, null, 2)}</pre>
          </details>
        )}
      </section>
    </main>
  );
}
