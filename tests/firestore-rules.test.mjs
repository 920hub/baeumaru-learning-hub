import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,setDoc,getDoc,getDocs,updateDoc,deleteDoc,query,limit,orderBy,serverTimestamp,Timestamp} from 'firebase/firestore';

test('production Firestore rules isolate Google users and validate every write', {skip:!process.env.FIRESTORE_EMULATOR_HOST}, async t=>{
  const env=await initializeTestEnvironment({projectId:'demo-baeumaru',firestore:{rules:await readFile(new URL('../firebase/firestore.rules',import.meta.url),'utf8')}});
  try {
    const claims={email_verified:true,firebase:{sign_in_provider:'google.com'}};
    const alpha=env.authenticatedContext('alpha',claims).firestore();
    const beta=env.authenticatedContext('beta',claims).firestore();
    const anonymous=env.unauthenticatedContext().firestore();
    const wrongProvider=env.authenticatedContext('alpha',{email_verified:true,firebase:{sign_in_provider:'anonymous'}}).firestore();
    const unverified=env.authenticatedContext('alpha',{email_verified:false,firebase:{sign_in_provider:'google.com'}}).firestore();
    const fields=()=>({date:'2026-11-11',title:'Synthetic entry',content:'Synthetic content only',mood:'calm',favorite:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    const ref=db=>doc(db,'users','alpha','entries','entry1');
    await t.test('owner can create and read, other identities cannot',async()=>{
      await assertSucceeds(setDoc(ref(alpha),fields()));
      assert.equal((await assertSucceeds(getDoc(ref(alpha)))).data().title,'Synthetic entry');
      await assertFails(getDoc(ref(beta)));
      await assertFails(getDoc(ref(anonymous)));
      await assertFails(getDoc(ref(wrongProvider)));
      await assertFails(getDoc(ref(unverified)));
    });
    await t.test('lists require owner and bounded limit',async()=>{
      await assertSucceeds(getDocs(query(collection(alpha,'users','alpha','entries'),orderBy('date','desc'),limit(100))));
      await assertFails(getDocs(query(collection(beta,'users','alpha','entries'),limit(100))));
      await assertFails(getDocs(collection(alpha,'users','alpha','entries')));
      await assertFails(getDocs(query(collection(alpha,'users','alpha','entries'),limit(101))));
      await assertFails(getDocs(query(collection(alpha,'users'),limit(10))));
    });
    await t.test('cross-user create/update/delete are rejected',async()=>{
      await assertFails(setDoc(doc(beta,'users','alpha','entries','other'),fields()));
      await assertFails(updateDoc(ref(beta),{title:'Unauthorized',updatedAt:serverTimestamp()}));
      await assertFails(deleteDoc(ref(beta)));
    });
    await t.test('schema, extra privilege fields and timestamp forgery are rejected',async()=>{
      for(const change of [{role:'admin'},{ownerId:'beta'},{title:123},{content:'x'.repeat(100001)},{date:'2026-99-99'},{favorite:'true'},{mood:'unknown'},{createdAt:Timestamp.fromMillis(0)}]){
        await assertFails(setDoc(doc(alpha,'users','alpha','entries','bad'),{...fields(),...change}));
      }
      await assertFails(setDoc(doc(alpha,'users','alpha'),{name:'Not allowed'}));
    });
    await t.test('valid update preserves createdAt and missing required fields are rejected',async()=>{
      const before=(await getDoc(ref(alpha))).data().createdAt;
      await assertSucceeds(updateDoc(ref(alpha),{title:'Updated synthetic entry',favorite:true,updatedAt:serverTimestamp()}));
      assert.deepEqual((await getDoc(ref(alpha))).data().createdAt,before);
      await assertFails(updateDoc(ref(alpha),{createdAt:Timestamp.fromMillis(0),updatedAt:serverTimestamp()}));
      await assertFails(setDoc(ref(alpha),{title:'missing fields',updatedAt:serverTimestamp()}));
      await assertSucceeds(deleteDoc(ref(alpha)));
    });
    await t.test('calendar and nonblank validation applies to both creates and updates',async()=>{
      const target=doc(alpha,'users','alpha','entries','calendar');
      await assertSucceeds(setDoc(target,fields()));
      for(const change of [{date:'2026-02-30'},{date:'2026-04-31'},{date:'1900-02-29'},{date:'0000-01-01'},{title:' \t\n'},{content:' \t\n'},{title:'\u00a0\u3000'},{content:'\u00a0\u3000'}]){
        await assertFails(setDoc(doc(alpha,'users','alpha','entries','invalid-calendar'),{...fields(),...change}));
        await assertFails(updateDoc(target,{...change,updatedAt:serverTimestamp()}));
      }
      for(const date of ['0001-01-01','2000-02-29','2024-02-29','2026-04-30','9999-12-31']){
        await assertSucceeds(updateDoc(target,{date,updatedAt:serverTimestamp()}));
      }
      await assertSucceeds(deleteDoc(target));
    });
  } finally {await env.cleanup();}
});
