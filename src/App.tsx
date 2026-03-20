import { useState } from "react";
import {
  Account as Sdk6Account,
  Aptos,
  AptosConfig,
  Deserializer,
  Ed25519PrivateKey as Ed25519PrivateKeyV6,
  Network,
  Serializer as SerializerV6,
  SimpleTransaction,
  type AnyRawTransaction,
} from "@aptos-labs/ts-sdk";
import * as sdkV5 from "aptos-sdk-v5";
import { WalletSelector } from "@aptos-labs/wallet-adapter-ant-design";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
const aptosV5 = new sdkV5.Aptos(new sdkV5.AptosConfig({ network: sdkV5.Network.TESTNET }));
const RECIPIENT = "0x1";
const AMOUNT_OCTA = 100;
const EXPLORER_BASE = "https://explorer.aptoslabs.com/txn";
const LOCAL_SIGNER_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

type TxMethod =
  | "signAndSubmit"
  | "signThenSubmit"
  | "signThenSubmitV5"
  | "v6BuildFeePayerThenV5Sign"
  | "v6BuildFeePayerThenV6Sign";
type SdkLabel = "v6.2.0" | "v5.1.1" | "v6-build+v5-sign" | "v6-build+v6-sign";

type TxResult = {
  status: "idle" | "submitting" | "success" | "error";
  buildMode?: "payload" | "builtRawTx";
  mode?: "normal" | "withFeePayer";
  method?: TxMethod;
  sdk?: SdkLabel;
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
  sdk?: SdkLabel;
};

type TxLogEntry = {
  id: string;
  time: string;
  event: string;
  method: TxMethod;
  mode: "normal" | "withFeePayer";
  sdk: SdkLabel;
  data: unknown;
};

function shortAddress(value?: string | null): string {
  if (!value) return "-";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function stringifyForDisplay(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_, current) => {
        if (typeof current === "bigint") return current.toString();
        if (current instanceof Uint8Array) return bytesToHex(current);
        if (typeof current === "object" && current !== null) {
          if (seen.has(current)) return "[Circular]";
          seen.add(current);
        }
        return current;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

function hasMethod(value: unknown, methodName: string): boolean {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const target = value as Record<string, unknown>;
  return typeof target[methodName] === "function";
}

function getConstructorName(value: unknown): string | null {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  return ctor?.name ?? null;
}

function getPrototypeChain(value: unknown, maxDepth = 6): string[] {
  const chain: string[] = [];
  if (!value || (typeof value !== "object" && typeof value !== "function")) return chain;
  let current: object | null = value as object;
  let depth = 0;
  while (current && depth < maxDepth) {
    const ctorName = (current as { constructor?: { name?: string } }).constructor?.name ?? "Unknown";
    chain.push(ctorName);
    current = Object.getPrototypeOf(current);
    depth += 1;
  }
  return chain;
}

function serializeErrorForLog(err: unknown): unknown {
  if (err instanceof Error) {
    const extra = err as Error & { code?: unknown; data?: unknown; cause?: unknown };
    return {
      name: extra.name,
      message: extra.message,
      stack: extra.stack ?? null,
      code: extra.code ?? null,
      data: extra.data ?? null,
      cause: extra.cause ?? null,
      constructor: getConstructorName(extra),
    };
  }
  if (typeof err === "object" && err !== null) {
    return {
      constructor: getConstructorName(err),
      keys: Object.keys(err as Record<string, unknown>),
      value: err,
    };
  }
  return err;
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
    return { text: text || "Unknown wallet error", raw: serializeErrorForLog(extra) };
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
  const [txLogs, setTxLogs] = useState<TxLogEntry[]>([]);

  const networkName = network?.name ?? "unknown";
  const accountAddress = account?.address?.toString();

  const pushTxLog = (entry: Omit<TxLogEntry, "id" | "time">) => {
    setTxLogs((prev) => [
      ...prev,
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: new Date().toISOString(),
      },
    ]);
  };

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

  const buildTransferTxV5 = async ({
    sender,
    recipient,
    amount,
    withFeePayer,
  }: {
    sender: string;
    recipient: string;
    amount: number;
    withFeePayer: boolean;
  }) => {
    return aptosV5.transaction.build.simple({
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
    method: TxMethod;
  }) => {
    const mode = withFeePayer ? "withFeePayer" : "normal";
    const buildMode = method === "signAndSubmit" ? "payload" : "builtRawTx";
    const sdk: SdkLabel =
      method === "signThenSubmitV5"
        ? "v5.1.1"
        : method === "v6BuildFeePayerThenV5Sign"
          ? "v6-build+v5-sign"
          : method === "v6BuildFeePayerThenV6Sign"
            ? "v6-build+v6-sign"
          : "v6.2.0";
    pushTxLog({
      event: "click",
      method,
      mode,
      sdk,
      data: {
        network: networkName,
        walletName: wallet?.name ?? null,
        sender: accountAddress ?? null,
        recipient: RECIPIENT,
        amount: AMOUNT_OCTA,
        withFeePayer,
      },
    });

    if (method === "v6BuildFeePayerThenV5Sign") {
      setTxResult({
        status: "submitting",
        buildMode,
        mode: "withFeePayer",
        method,
        sdk,
      });
      try {
        const v5PrivateKey = new sdkV5.Ed25519PrivateKey(LOCAL_SIGNER_PRIVATE_KEY);
        const v5Signer = sdkV5.Account.fromPrivateKey({
          privateKey: v5PrivateKey,
          legacy: true,
        }) as sdkV5.Ed25519Account;
        const sender = v5Signer.accountAddress.toString();
        const builtTx = await buildTransferTx({
          sender,
          recipient: RECIPIENT,
          amount: AMOUNT_OCTA,
          withFeePayer: true,
        });
        const builtTxHex = bytesToHex(builtTx.bcsToBytes());
        const rawTransactionHex =
          typeof (builtTx as { rawTransaction?: { bcsToBytes?: () => Uint8Array } }).rawTransaction
            ?.bcsToBytes === "function"
            ? bytesToHex(
                (
                  builtTx as {
                    rawTransaction: { bcsToBytes: () => Uint8Array };
                  }
                ).rawTransaction.bcsToBytes(),
              )
            : null;
        pushTxLog({
          event: "built_tx",
          method,
          mode: "withFeePayer",
          sdk,
          data: {
            sender,
            withFeePayer: true,
            txType: builtTx.constructor.name,
            builtTxHex,
            rawTransactionHex,
          },
        });
        pushTxLog({
          event: "v5_type_diagnostics",
          method,
          mode: "withFeePayer",
          sdk,
          data: {
            builtTxConstructor: getConstructorName(builtTx),
            builtTxPrototypeChain: getPrototypeChain(builtTx),
            rawTransactionConstructor: getConstructorName(
              (builtTx as { rawTransaction?: unknown }).rawTransaction,
            ),
            rawTransactionPrototypeChain: getPrototypeChain(
              (builtTx as { rawTransaction?: unknown }).rawTransaction,
            ),
            checks: {
              builtTxHasSerialize: hasMethod(builtTx, "serialize"),
              builtTxHasBcsToBytes: hasMethod(builtTx, "bcsToBytes"),
              builtTxHasRawTransaction: "rawTransaction" in (builtTx as object),
              rawTxnHasSerialize: hasMethod(
                (builtTx as { rawTransaction?: unknown }).rawTransaction,
                "serialize",
              ),
              rawTxnHasBcsToBytes: hasMethod(
                (builtTx as { rawTransaction?: unknown }).rawTransaction,
                "bcsToBytes",
              ),
              isV6SimpleTransaction: builtTx instanceof SimpleTransaction,
              isV5SimpleTransaction: builtTx instanceof sdkV5.SimpleTransaction,
            },
            serializerCapabilities: {
              v5HasSerializeAsBytes: hasMethod(sdkV5.Serializer.prototype, "serializeAsBytes"),
              v6HasSerializeAsBytes: hasMethod(SerializerV6.prototype, "serializeAsBytes"),
            },
          },
        });

        try {
          const v5Serializer = new sdkV5.Serializer();
          (builtTx as unknown as { serialize: (s: unknown) => void }).serialize(v5Serializer);
          pushTxLog({
            event: "v5_preflight_serialize",
            method,
            mode: "withFeePayer",
            sdk,
            data: { ok: true },
          });
        } catch (preflightError) {
          pushTxLog({
            event: "v5_preflight_serialize",
            method,
            mode: "withFeePayer",
            sdk,
            data: {
              ok: false,
              error: serializeErrorForLog(preflightError),
            },
          });
        }

        let v5Authenticator: ReturnType<typeof v5Signer.signTransactionWithAuthenticator>;
        try {
          v5Authenticator = v5Signer.signTransactionWithAuthenticator(
            builtTx as unknown as Parameters<typeof v5Signer.signTransactionWithAuthenticator>[0],
          );
        } catch (v5SignError) {
          pushTxLog({
            event: "v5_sign_throw",
            method,
            mode: "withFeePayer",
            sdk,
            data: serializeErrorForLog(v5SignError),
          });
          throw v5SignError;
        }
        const authenticatorHex =
          typeof (v5Authenticator as { bcsToBytes?: () => Uint8Array }).bcsToBytes === "function"
            ? bytesToHex((v5Authenticator as { bcsToBytes: () => Uint8Array }).bcsToBytes())
            : null;
        pushTxLog({
          event: "v5_sign_result",
          method,
          mode: "withFeePayer",
          sdk,
          data: {
            signerAddress: sender,
            authenticatorType: v5Authenticator.constructor.name,
            authenticatorHex,
          },
        });

        setLastBuildSummary({
          sender,
          recipient: RECIPIENT,
          amount: AMOUNT_OCTA,
          withFeePayer: true,
          txType: builtTx.constructor.name,
          serializedBytes: builtTx.bcsToBytes().byteLength,
          sdk,
        });
        setTxResult({
          status: "success",
          buildMode,
          mode: "withFeePayer",
          method,
          sdk,
        });
      } catch (error) {
        const normalized = normalizeError(error);
        pushTxLog({
          event: "error",
          method,
          mode: "withFeePayer",
          sdk,
          data: {
            text: normalized.text,
            raw: serializeErrorForLog(normalized.raw),
          },
        });
        setTxResult({
          status: "error",
          buildMode,
          mode: "withFeePayer",
          method,
          sdk,
          errorText: normalized.text,
          errorRaw: {
            context: {
              withFeePayer: true,
              method,
              buildMode,
              sdk,
              signer: "local-v5-ed25519",
              recipient: RECIPIENT,
              amount: AMOUNT_OCTA,
            },
            raw: normalized.raw,
          },
        });
      }
      return;
    }

    if (method === "v6BuildFeePayerThenV6Sign") {
      setTxResult({
        status: "submitting",
        buildMode,
        mode: "withFeePayer",
        method,
        sdk,
      });
      try {
        const v6PrivateKey = new Ed25519PrivateKeyV6(LOCAL_SIGNER_PRIVATE_KEY);
        const v6Signer = Sdk6Account.fromPrivateKey({
          privateKey: v6PrivateKey,
          legacy: true,
        });
        const sender = v6Signer.accountAddress.toString();
        const builtTx = await buildTransferTx({
          sender,
          recipient: RECIPIENT,
          amount: AMOUNT_OCTA,
          withFeePayer: true,
        });
        const builtTxHex = bytesToHex(builtTx.bcsToBytes());
        const rawTransactionHex =
          typeof (builtTx as { rawTransaction?: { bcsToBytes?: () => Uint8Array } }).rawTransaction
            ?.bcsToBytes === "function"
            ? bytesToHex(
                (
                  builtTx as {
                    rawTransaction: { bcsToBytes: () => Uint8Array };
                  }
                ).rawTransaction.bcsToBytes(),
              )
            : null;
        pushTxLog({
          event: "built_tx",
          method,
          mode: "withFeePayer",
          sdk,
          data: {
            sender,
            withFeePayer: true,
            txType: builtTx.constructor.name,
            builtTxHex,
            rawTransactionHex,
          },
        });

        const v6Authenticator = v6Signer.signTransactionWithAuthenticator(builtTx);
        const authenticatorHex =
          typeof (v6Authenticator as { bcsToBytes?: () => Uint8Array }).bcsToBytes === "function"
            ? bytesToHex((v6Authenticator as { bcsToBytes: () => Uint8Array }).bcsToBytes())
            : null;
        pushTxLog({
          event: "v6_sign_result",
          method,
          mode: "withFeePayer",
          sdk,
          data: {
            signerAddress: sender,
            authenticatorType: v6Authenticator.constructor.name,
            authenticatorHex,
          },
        });

        setLastBuildSummary({
          sender,
          recipient: RECIPIENT,
          amount: AMOUNT_OCTA,
          withFeePayer: true,
          txType: builtTx.constructor.name,
          serializedBytes: builtTx.bcsToBytes().byteLength,
          sdk,
        });
        setTxResult({
          status: "success",
          buildMode,
          mode: "withFeePayer",
          method,
          sdk,
        });
      } catch (error) {
        const normalized = normalizeError(error);
        pushTxLog({
          event: "error",
          method,
          mode: "withFeePayer",
          sdk,
          data: {
            text: normalized.text,
            raw: normalized.raw,
          },
        });
        setTxResult({
          status: "error",
          buildMode,
          mode: "withFeePayer",
          method,
          sdk,
          errorText: normalized.text,
          errorRaw: {
            context: {
              withFeePayer: true,
              method,
              buildMode,
              sdk,
              signer: "local-v6-ed25519",
              recipient: RECIPIENT,
              amount: AMOUNT_OCTA,
            },
            raw: normalized.raw,
          },
        });
      }
      return;
    }

    if (!connected || !accountAddress) {
      setTxResult({
        status: "error",
        buildMode,
        mode,
        method,
        sdk,
        errorText: "Wallet not connected. Please connect Petra first.",
        errorRaw: null,
      });
      pushTxLog({
        event: "blocked:not_connected",
        method,
        mode,
        sdk,
        data: null,
      });
      return;
    }

    if (networkName.toLowerCase() !== "testnet") {
      setTxResult({
        status: "error",
        buildMode,
        mode,
        method,
        sdk,
        errorText: `Network mismatch: wallet=${networkName}. Please switch to testnet in Petra.`,
        errorRaw: network,
      });
      pushTxLog({
        event: "blocked:wrong_network",
        method,
        mode,
        sdk,
        data: { walletNetwork: networkName, expected: "testnet" },
      });
      return;
    }

    setLastBuildSummary({
      sender: accountAddress,
      recipient: RECIPIENT,
      amount: AMOUNT_OCTA,
      withFeePayer,
      sdk,
    });
    setTxResult({ status: "submitting", buildMode, mode, method, sdk });

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
      pushTxLog({
        event: "txn_input",
        method,
        mode,
        sdk,
        data: transactionInput,
      });

      let hash: string;
      if (method === "signAndSubmit") {
        const response = await signAndSubmitTransaction(transactionInput);
        hash = response.hash;
        pushTxLog({
          event: "signAndSubmit_response",
          method,
          mode,
          sdk,
          data: response,
        });
      } else {
        const builtTx =
          method === "signThenSubmitV5"
            ? await buildTransferTxV5({
                sender: accountAddress,
                recipient: RECIPIENT,
                amount: AMOUNT_OCTA,
                withFeePayer,
              })
            : await buildTransferTx({
                sender: accountAddress,
                recipient: RECIPIENT,
                amount: AMOUNT_OCTA,
                withFeePayer,
              });
        const builtTxHex =
          typeof (builtTx as { bcsToBytes?: () => Uint8Array }).bcsToBytes === "function"
            ? bytesToHex((builtTx as { bcsToBytes: () => Uint8Array }).bcsToBytes())
            : null;
        pushTxLog({
          event: "built_tx",
          method,
          mode,
          sdk,
          data: {
            txType: builtTx.constructor.name,
            withFeePayer,
            builtTxHex,
          },
        });
        const signed = await signTransaction({
          transactionOrPayload:
            builtTx as unknown as Parameters<typeof signTransaction>[0]["transactionOrPayload"],
        });
        pushTxLog({
          event: "signed_tx",
          method,
          mode,
          sdk,
          data: {
            rawTransactionHex: bytesToHex(signed.rawTransaction),
            authenticator: signed.authenticator,
          },
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
        pushTxLog({
          event: "submit_response",
          method,
          mode,
          sdk,
          data: submitted,
        });

        setLastBuildSummary({
          sender: accountAddress,
          recipient: RECIPIENT,
          amount: AMOUNT_OCTA,
          withFeePayer,
          txType: builtTx.constructor.name,
          serializedBytes: rawBytes,
          sdk,
        });
      }

      await aptos.waitForTransaction({ transactionHash: hash });
      pushTxLog({
        event: "confirmed",
        method,
        mode,
        sdk,
        data: { hash },
      });

      setTxResult({
        status: "success",
        buildMode,
        mode,
        method,
        sdk,
        hash,
        explorerUrl: `${EXPLORER_BASE}/${hash}?network=testnet`,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      pushTxLog({
        event: "error",
        method,
        mode,
        sdk,
        data: {
          text: normalized.text,
          raw: normalized.raw,
        },
      });
      setTxResult({
        status: "error",
        buildMode,
        mode,
        method,
        sdk,
        errorText: normalized.text,
        errorRaw: {
          context: {
            withFeePayer,
            method,
            buildMode,
            sdk,
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
          <button
            className="send-btn"
            onClick={() => runTx({ withFeePayer: true, method: "signThenSubmitV5" })}
            disabled={txResult.status === "submitting"}
          >
            FeePayer + SignThenSubmit (SDK v5)
          </button>
          <button
            className="send-btn"
            onClick={() => runTx({ withFeePayer: true, method: "v6BuildFeePayerThenV5Sign" })}
            disabled={txResult.status === "submitting"}
          >
            Build(v6)+FeePayer to Sign(v5)
          </button>
          <button
            className="send-btn"
            onClick={() => runTx({ withFeePayer: true, method: "v6BuildFeePayerThenV6Sign" })}
            disabled={txResult.status === "submitting"}
          >
            Build(v6)+FeePayer to Sign(v6)
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
        <p>
          <strong>SDK:</strong> {txResult.sdk ?? "-"}
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

      <section className="card">
        <h2>Txn Logs</h2>
        <p>Total: {txLogs.length}</p>
        <button className="send-btn" onClick={() => setTxLogs([])} disabled={txLogs.length === 0}>
          Clear Logs
        </button>
        <ol className="log-list">
          {txLogs.map((log) => (
            <li key={log.id} className="log-item">
              <p>
                <strong>{log.time}</strong> | {log.method} | {log.mode} | {log.sdk} | {log.event}
              </p>
              <pre>{stringifyForDisplay(log.data)}</pre>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
