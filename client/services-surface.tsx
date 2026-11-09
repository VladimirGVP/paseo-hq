import {useCallback,useEffect,useState} from 'react';
import {Text,View,ScrollView,Pressable} from 'react-native';
import {useRpc,type PluginSurfaceProps} from '@getpaseo/plugin/client';
import {read,type ServiceRow} from '../shared/services-contracts';
export function Services({theme,layout}:PluginSurfaceProps){
 const rpc=useRpc(read),[rows,setRows]=useState<ServiceRow[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{setBusy(true);try{const r=await rpc({});setRows(r.rows);setError('');}catch{setError('Не удалось обновить. Показаны прежние данные.');}finally{setBusy(false);}},[rpc]);
 useEffect(()=>{void load();const t=setInterval(()=>void load(),30000);return ()=>clearInterval(t);},[load]);
 const c=theme.colors;
 return <ScrollView style={{flex:1,backgroundColor:c.surface0}} contentContainerStyle={{padding:layout.compact?16:28,gap:12}}>
  <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Text style={{color:c.foreground,fontSize:24,fontWeight:'600'}}>Службы</Text><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void load()} style={{padding:12}}><Text style={{color:c.accent}}>{busy?'Обновление…':'Обновить'}</Text></Pressable></View>
  {error?<Text style={{color:c.foreground}}>{error}</Text>:null}
  {rows.map(r=><View key={r.id} style={{paddingVertical:14,borderBottomWidth:1,borderColor:c.border,gap:6}}>
   <View style={{flexDirection:'row',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><Text style={{color:c.foreground,fontSize:16,fontWeight:'600'}}>{r.name}</Text><Text style={{color:r.status==='Ошибка'?'#e98080':c.foregroundMuted}}>{r.status}</Text></View>
   <Text style={{color:c.foregroundMuted,fontSize:14}}>{r.description}</Text>
   <View style={{flexDirection:'row',gap:16,flexWrap:'wrap'}}><Text style={{color:c.foregroundMuted,fontSize:12}}>{r.kind}</Text><Text style={{color:c.foregroundMuted,fontSize:12}}>Последний запуск: {r.lastRun||'нет данных'}</Text></View>
  </View>)}
 </ScrollView>;
}
