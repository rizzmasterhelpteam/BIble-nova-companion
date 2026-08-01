import { platform } from "../../platform";

export const isNativePlatform = () => platform.isNative;

export const getNativePlatform = () => platform.kind;

export const getPlatformAdapter = () => platform;
