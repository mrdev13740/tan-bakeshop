
import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
  } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
  
  import {
    doc,
    getDoc
  } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
  
  import { auth, db } from "./firebase.js";
  
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginButton = document.getElementById("loginButton");
  const loginMessage = document.getElementById("loginMessage");
  
  let checkingSession = true;
  
  function showMessage(message) {
    loginMessage.textContent = message;
  }
  
  async function isApprovedStaff(user) {
    const staffRef = doc(db, "staff", user.uid);
    const staffSnapshot = await getDoc(staffRef);
  
    return (
      staffSnapshot.exists() &&
      staffSnapshot.data().approved === true
    );
  }
  
  // Check whether a previously signed-in user is still approved.
  onAuthStateChanged(auth, async (user) => {
    if (!checkingSession) return;
    checkingSession = false;
  
    if (!user) return;
  
    try {
      if (await isApprovedStaff(user)) {
        window.location.replace("./index.html");
      } else {
        await signOut(auth);
        showMessage("This account has not been approved for Olive POS.");
      }
    } catch (error) {
      console.error("Staff verification failed:", error);
      showMessage("Unable to verify staff access. Please try again.");
    }
  });
  
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
  
    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    showMessage("");
  
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        emailInput.value.trim(),
        passwordInput.value
      );
  
      const approved = await isApprovedStaff(credential.user);
  
      if (!approved) {
        await signOut(auth);
        showMessage("This account has not been approved for Olive POS.");
        return;
      }
  
      window.location.replace("./index.html");
    } catch (error) {
      console.error("Login failed:", error);
  
      if (error.code === "auth/invalid-credential") {
        showMessage("Incorrect email or password.");
      } else if (error.code === "auth/too-many-requests") {
        showMessage("Too many attempts. Please try again later.");
      } else {
        showMessage("Sign-in failed. Check your connection and try again.");
      }
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Sign in";
    }
  });
  