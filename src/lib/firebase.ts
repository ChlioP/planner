import { getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
);

const app = firebaseEnabled ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
export const firebaseAuth = app ? getAuth(app) : null;
export const firestore = app ? initializeFirestore(app, { ignoreUndefinedProperties: true }) : null;

export function observeFirebaseUser(callback: (user: User | null) => void) {
  if (!firebaseAuth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function signInWithGoogle() {
  if (!firebaseAuth) throw new Error("Firebase is not configured.");
  return signInWithPopup(firebaseAuth, new GoogleAuthProvider());
}

export async function signOutFirebase() {
  if (!firebaseAuth) return;
  await signOut(firebaseAuth);
}

export type { User };
