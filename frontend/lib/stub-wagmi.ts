// wagmi stub — never mounted, kept for import compat.
import React from 'react';

export function WagmiProvider({ children }: any) {
    return children;
}

export function useAccount() {
    return {
        address: undefined,
        isConnected: false,
        connector: null,
        chainId: null,
    };
}

export function useConnect() {
    return { connect: () => {}, connectors: [] };
}

export function useDisconnect() {
    return { disconnect: () => {} };
}

export function useConnectors() {
    return [];
}

export function useSignMessage() {
    return {
        signMessageAsync: async (_: any) => null as any,
    };
}

export function createConfig(_: any) {
    return {} as any;
}

export function http(_?: any) {
    return {} as any;
}
