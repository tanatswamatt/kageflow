-- Kageflow 0020: KF-D04 shared invoice links return only what is printed on the document, not internal ids
do $$
declare v_def text := pg_get_functiondef('public.shared_sales_doc(text)'::regprocedure);
begin
  v_def := replace(v_def,
    $r$'doc', to_jsonb(d) - 'share_token' - 'journal_id' - 'created_by' - 'issued_by',$r$,
    $r$'doc', to_jsonb(d) - 'share_token' - 'journal_id' - 'created_by' - 'issued_by' - 'id' - 'company_id' - 'account_id' - 'contact_id' - 'deal_id' - 'source_doc_id' - 'salesperson_id' - 'updated_at',$r$);
  if position('salesperson_id' in v_def) = 0 then raise exception 'shared_sales_doc patch did not apply'; end if;
  execute v_def;
end $$;
