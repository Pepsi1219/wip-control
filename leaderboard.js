(() => {
  const firebaseVersion = '11.10.0';
  const firebaseBase = `https://www.gstatic.com/firebasejs/${firebaseVersion}`;

  window.WIP_LEADERBOARD_READY = (async () => {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import(`${firebaseBase}/firebase-app.js`),
      import(`${firebaseBase}/firebase-auth.js`),
      import(`${firebaseBase}/firebase-firestore.js`)
    ]);
    const app = appSdk.initializeApp(window.WIP_FIREBASE_CONFIG);
    const auth = authSdk.getAuth(app);
    const db = firestoreSdk.getFirestore(app);

    async function authenticatedUser() {
      if (auth.currentUser) return auth.currentUser;
      const credential = await authSdk.signInAnonymously(auth);
      return credential.user;
    }

    return {
      async save(score) {
        const user = await authenticatedUser();
        const ref = await firestoreSdk.addDoc(firestoreSdk.collection(db, 'wipControlScores'), {
          nickname: score.nickname,
          points: score.points,
          maxPoints: score.maxPoints,
          accuracy: score.accuracy,
          elapsedSeconds: score.elapsedSeconds,
          completedAt: firestoreSdk.serverTimestamp(),
          uid: user.uid
        });
        try {
          sessionStorage.removeItem('wip-control-leaderboard-v1');
        } catch {}
        return ref.id;
      },
      async top() {
        const result = await firestoreSdk.getDocs(firestoreSdk.query(
          firestoreSdk.collection(db, 'wipControlScores'),
          firestoreSdk.orderBy('points', 'desc'),
          firestoreSdk.limit(100)
        ));
        return result.docs.map(document => {
          const data = document.data();
          return {
            nickname: data.nickname,
            points: data.points,
            maxPoints: data.maxPoints,
            accuracy: data.accuracy,
            elapsedSeconds: data.elapsedSeconds,
            completedAt: data.completedAt?.toMillis?.() ?? null
          };
        });
      }
    };
  })();
})();