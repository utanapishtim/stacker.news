import Button from 'react-bootstrap/Button'
import InputGroup from 'react-bootstrap/InputGroup'
import BootstrapForm from 'react-bootstrap/Form'
import { Formik, Form as FormikForm, useFormikContext, useField, FieldArray } from 'formik'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import copy from 'clipboard-copy'
import Col from 'react-bootstrap/Col'
import Dropdown from 'react-bootstrap/Dropdown'
import Nav from 'react-bootstrap/Nav'
import Row from 'react-bootstrap/Row'
import Markdown from '../svgs/markdown-line.svg'
import AddImageIcon from '../svgs/image-add-line.svg'
import styles from './form.module.css'
import Text from '../components/text'
import AddIcon from '../svgs/add-fill.svg'
import CloseIcon from '../svgs/close-line.svg'
import { gql, useLazyQuery } from '@apollo/client'
import { TOP_USERS, USER_SEARCH } from '../fragments/users'
import TextareaAutosize from 'react-textarea-autosize'
import { useToast } from './toast'
import { useInvoiceable } from './invoice'
import { numWithUnits } from '../lib/format'
import textAreaCaret from 'textarea-caret'
import ReactDatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import useDebounceCallback, { debounce } from './use-debounce-callback'
import { ImageUpload } from './image'
import { AWS_S3_URL_REGEXP } from '../lib/constants'
import { dayMonthYear, dayMonthYearToDate, whenToFrom } from '../lib/time'
import { useFeeButton } from './fee-button'
import Thumb from '../svgs/thumb-up-fill.svg'

export function SubmitButton ({
  children, variant, value, onClick, disabled, ...props
}) {
  const formik = useFormikContext()

  return (
    <Button
      variant={variant || 'main'}
      type='submit'
      disabled={disabled || formik.isSubmitting}
      onClick={value
        ? e => {
          formik.setFieldValue('submit', value)
          onClick && onClick(e)
        }
        : onClick}
      {...props}
    >
      {children}
    </Button>
  )
}

export function CopyInput (props) {
  const toaster = useToast()
  const [copied, setCopied] = useState(false)

  const handleClick = async () => {
    try {
      await copy(props.placeholder)
      toaster.success('copied')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      toaster.danger('failed to copy')
    }
  }

  return (
    <Input
      onClick={handleClick}
      append={
        <Button
          className={styles.appendButton}
          size={props.size}
          onClick={handleClick}
        >{copied ? <Thumb width={18} height={18} /> : 'copy'}
        </Button>
      }
      {...props}
    />
  )
}

export function InputSkeleton ({ label, hint }) {
  return (
    <BootstrapForm.Group>
      {label && <BootstrapForm.Label>{label}</BootstrapForm.Label>}
      <div className='form-control clouds' style={{ color: 'transparent' }}>.</div>
      {hint &&
        <BootstrapForm.Text>
          {hint}
        </BootstrapForm.Text>}
    </BootstrapForm.Group>
  )
}

const DEFAULT_MENTION_INDICES = { start: -1, end: -1 }
export function MarkdownInput ({ label, topLevel, groupClassName, onChange, onKeyDown, innerRef, ...props }) {
  const [tab, setTab] = useState('write')
  const [, meta, helpers] = useField(props)
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 })
  innerRef = innerRef || useRef(null)
  const imageUploadRef = useRef(null)
  const previousTab = useRef(tab)
  const { merge } = useFeeButton()
  const toaster = useToast()
  const [updateImageFeesInfo] = useLazyQuery(gql`
  query imageFeesInfo($s3Keys: [Int]!) {
    imageFeesInfo(s3Keys: $s3Keys) {
      totalFees
      nUnpaid
      imageFee
      bytes24h
    }
  }`, {
    fetchPolicy: 'no-cache',
    nextFetchPolicy: 'no-cache',
    onError: (err) => {
      console.log(err)
      toaster.danger(err.message || err.toString?.())
    },
    onCompleted: ({ imageFeesInfo }) => {
      merge({
        imageFee: {
          term: `+ ${numWithUnits(imageFeesInfo.totalFees, { abbreviate: false })}`,
          label: 'image fee',
          modifier: cost => cost + imageFeesInfo.totalFees,
          omit: !imageFeesInfo.totalFees
        }
      })
    }
  })

  props.as ||= TextareaAutosize
  props.rows ||= props.minRows || 6

  useEffect(() => {
    !meta.value && setTab('write')
  }, [meta.value])

  useEffect(() => {
    // focus on input when switching to write tab from preview tab
    if (innerRef?.current && tab === 'write' && previousTab?.current !== 'write') {
      innerRef.current.focus()
    }
    previousTab.current = tab
  }, [tab])

  useEffect(() => {
    if (selectionRange.start <= selectionRange.end && innerRef?.current) {
      const { start, end } = selectionRange
      const input = innerRef.current
      input.setSelectionRange(start, end)
    }
  }, [innerRef, selectionRange.start, selectionRange.end])

  const [mentionQuery, setMentionQuery] = useState()
  const [mentionIndices, setMentionIndices] = useState(DEFAULT_MENTION_INDICES)
  const [userSuggestDropdownStyle, setUserSuggestDropdownStyle] = useState({})
  const insertMention = useCallback((name) => {
    const { start, end } = mentionIndices
    const first = `${innerRef.current.value.substring(0, start)}@${name}`
    const second = innerRef.current.value.substring(end)
    const updatedValue = `${first}${second}`
    innerRef.current.value = updatedValue
    helpers.setValue(updatedValue)
    setSelectionRange({ start: first.length, end: first.length })
    innerRef.current.focus()
  }, [mentionIndices, innerRef, helpers?.setValue])

  const imageFeesUpdate = useDebounceCallback(
    (text) => {
      const s3Keys = text ? [...text.matchAll(AWS_S3_URL_REGEXP)].map(m => Number(m[1])) : []
      updateImageFeesInfo({ variables: { s3Keys } })
    }, 1000, [updateImageFeesInfo])

  const onChangeInner = useCallback((formik, e) => {
    if (onChange) onChange(formik, e)
    // check for mention editing
    const { value, selectionStart } = e.target
    let priorSpace = -1
    for (let i = selectionStart - 1; i >= 0; i--) {
      if (/\s|\n/.test(value[i])) {
        priorSpace = i
        break
      }
    }
    let nextSpace = value.length
    for (let i = selectionStart; i <= value.length; i++) {
      if (/\s|\n/.test(value[i])) {
        nextSpace = i
        break
      }
    }
    const currentSegment = value.substring(priorSpace + 1, nextSpace)

    // set the query to the current character segment and note where it appears
    if (/^@[\w_]*$/.test(currentSegment)) {
      setMentionQuery(currentSegment)
      setMentionIndices({ start: priorSpace + 1, end: nextSpace })
      const { top, left } = textAreaCaret(e.target, e.target.selectionStart)
      setUserSuggestDropdownStyle({
        position: 'absolute',
        top: `${top + Number(window.getComputedStyle(e.target).lineHeight.replace('px', ''))}px`,
        left: `${left}px`
      })
    } else {
      setMentionQuery(undefined)
      setMentionIndices(DEFAULT_MENTION_INDICES)
    }

    imageFeesUpdate(value)
  }, [onChange, setMentionQuery, setMentionIndices, setUserSuggestDropdownStyle, imageFeesUpdate])

  const onKeyDownInner = useCallback((userSuggestOnKeyDown) => {
    return (e) => {
      const metaOrCtrl = e.metaKey || e.ctrlKey
      if (metaOrCtrl) {
        if (e.key === 'k') {
          // some browsers use CTRL+K to focus search bar so we have to prevent that behavior
          e.preventDefault()
          insertMarkdownLinkFormatting(innerRef.current, helpers.setValue, setSelectionRange)
        }
        if (e.key === 'b') {
          // some browsers use CTRL+B to open bookmarks so we have to prevent that behavior
          e.preventDefault()
          insertMarkdownBoldFormatting(innerRef.current, helpers.setValue, setSelectionRange)
        }
        if (e.key === 'i') {
          // some browsers might use CTRL+I to do something else so prevent that behavior too
          e.preventDefault()
          insertMarkdownItalicFormatting(innerRef.current, helpers.setValue, setSelectionRange)
        }
        if (e.key === 'Tab' && e.altKey) {
          e.preventDefault()
          insertMarkdownTabFormatting(innerRef.current, helpers.setValue, setSelectionRange)
        }
      }

      if (!metaOrCtrl) {
        userSuggestOnKeyDown(e)
      }

      if (onKeyDown) onKeyDown(e)
    }
  }, [innerRef, helpers?.setValue, setSelectionRange, onKeyDown])

  const onDrop = useCallback((event) => {
    event.preventDefault()
    setDragStyle(null)
    const changeEvent = new Event('change', { bubbles: true })
    imageUploadRef.current.files = event.dataTransfer.files
    imageUploadRef.current.dispatchEvent(changeEvent)
  }, [imageUploadRef])

  const [dragStyle, setDragStyle] = useState(null)
  const onDragEnter = useCallback((e) => {
    setDragStyle('over')
  }, [setDragStyle])
  const onDragLeave = useCallback((e) => {
    setDragStyle(null)
  }, [setDragStyle])

  return (
    <FormGroup label={label} className={groupClassName}>
      <div className={`${styles.markdownInput} ${tab === 'write' ? styles.noTopLeftRadius : ''}`}>
        <Nav variant='tabs' defaultActiveKey='write' activeKey={tab} onSelect={tab => setTab(tab)}>
          <Nav.Item>
            <Nav.Link className='py-1' eventKey='write'>write</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link className={styles.previewTab} eventKey='preview' disabled={!meta.value}>preview</Nav.Link>
          </Nav.Item>
          <span className='ms-auto text-muted d-flex align-items-center'>
            <ImageUpload
              multiple
              ref={imageUploadRef}
              className='d-flex align-items-center me-1'
              onUpload={file => {
                let text = innerRef.current.value
                if (text) text += '\n\n'
                text += `![Uploading ${file.name}…]()`
                helpers.setValue(text)
              }}
              onSuccess={({ url, name }) => {
                let text = innerRef.current.value
                text = text.replace(`![Uploading ${name}…]()`, `![${name}](${url})`)
                helpers.setValue(text)
                const s3Keys = [...text.matchAll(AWS_S3_URL_REGEXP)].map(m => Number(m[1]))
                updateImageFeesInfo({ variables: { s3Keys } })
              }}
              onError={({ name }) => {
                let text = innerRef.current.value
                text = text.replace(`![Uploading ${name}…]()`, '')
                helpers.setValue(text)
              }}
            >
              <AddImageIcon width={18} height={18} />
            </ImageUpload>
            <a
              className='d-flex align-items-center'
              href='https://guides.github.com/features/mastering-markdown/' target='_blank' rel='noreferrer'
            >
              <Markdown width={18} height={18} />
            </a>
          </span>
        </Nav>
        <div className={`position-relative ${tab === 'write' ? '' : 'd-none'}`}>
          <UserSuggest
            query={mentionQuery}
            onSelect={insertMention}
            dropdownStyle={userSuggestDropdownStyle}
          >{({ onKeyDown: userSuggestOnKeyDown, resetSuggestions }) => (
            <InputInner
              innerRef={innerRef}
              {...props}
              onChange={onChangeInner}
              onKeyDown={onKeyDownInner(userSuggestOnKeyDown)}
              onBlur={() => setTimeout(resetSuggestions, 100)}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={dragStyle === 'over' ? styles.dragOver : ''}
            />)}
          </UserSuggest>
        </div>
        {tab !== 'write' &&
          <div className='form-group'>
            <div className={`${styles.text} form-control`}>
              <Text topLevel={topLevel} noFragments tab={tab}>{meta.value}</Text>
            </div>
          </div>}
      </div>
    </FormGroup>
  )
}

function insertMarkdownFormatting (replaceFn, selectFn) {
  return function (input, setValue, setSelectionRange) {
    const start = input.selectionStart
    const end = input.selectionEnd
    const val = input.value
    const selectedText = val.substring(start, end)
    const mdFormatted = replaceFn(selectedText)
    const newVal = val.substring(0, start) + mdFormatted + val.substring(end)
    setValue(newVal)
    // required for undo, see https://stackoverflow.com/a/27028258
    document.execCommand('insertText', false, mdFormatted)
    // see https://github.com/facebook/react/issues/6483
    // for why we don't use `input.setSelectionRange` directly (hint: event order)
    setSelectionRange(selectFn ? selectFn(start, end, mdFormatted) : { start: start + mdFormatted.length, end: start + mdFormatted.length })
  }
}

const insertMarkdownTabFormatting = insertMarkdownFormatting(
  val => `\t${val}`,
  (start, end, mdFormatted) => ({ start: start + 1, end: end + 1 }) // move inside tab
)
const insertMarkdownLinkFormatting = insertMarkdownFormatting(
  val => `[${val}](url)`,
  (start, end, mdFormatted) => (
    start === end
      ? { start: start + 1, end: end + 1 } // move inside brackets
      : { start: start + mdFormatted.length - 4, end: start + mdFormatted.length - 1 }) // move to select url part
)
const insertMarkdownBoldFormatting = insertMarkdownFormatting(
  val => `**${val}**`,
  (start, end, mdFormatted) => ({ start: start + 2, end: end + 2 }) // move inside bold
)
const insertMarkdownItalicFormatting = insertMarkdownFormatting(
  val => `_${val}_`,
  (start, end, mdFormatted) => ({ start: start + 1, end: end + 1 }) // move inside italic
)

function FormGroup ({ className, label, children }) {
  return (
    <BootstrapForm.Group className={`form-group ${className}`}>
      {label && <BootstrapForm.Label>{label}</BootstrapForm.Label>}
      {children}
    </BootstrapForm.Group>
  )
}

function InputInner ({
  prepend, append, hint, showValid, onChange, onBlur, overrideValue,
  innerRef, noForm, clear, onKeyDown, inputGroupClassName, debounce: debounceTime, maxLength,
  ...props
}) {
  const [field, meta, helpers] = noForm ? [{}, {}, {}] : useField(props)
  const formik = noForm ? null : useFormikContext()
  const storageKeyPrefix = useContext(StorageKeyPrefixContext)

  const storageKey = storageKeyPrefix ? storageKeyPrefix + '-' + props.name : undefined

  const onKeyDownInner = useCallback((e) => {
    const metaOrCtrl = e.metaKey || e.ctrlKey
    if (metaOrCtrl) {
      if (e.key === 'Enter') formik?.submitForm()
    }

    if (onKeyDown) onKeyDown(e)
  }, [formik?.submitForm, onKeyDown])

  const onChangeInner = useCallback((e) => {
    field?.onChange(e)

    if (storageKey) {
      window.localStorage.setItem(storageKey, e.target.value)
    }

    if (onChange) {
      onChange(formik, e)
    }
  }, [field?.onChange, storageKey, onChange])

  const onBlurInner = useCallback((e) => {
    field?.onBlur?.(e)
    onBlur && onBlur(e)
  }, [field?.onBlur, onBlur])

  useEffect(() => {
    if (overrideValue) {
      helpers.setValue(overrideValue)
      if (storageKey) {
        window.localStorage.setItem(storageKey, overrideValue)
      }
    } else if (storageKey) {
      const draft = window.localStorage.getItem(storageKey)
      if (draft) {
        // for some reason we have to turn off validation to get formik to
        // not assume this is invalid
        helpers.setValue(draft, false)
        onChange && onChange(formik, { target: { value: draft } })
      }
    }
  }, [overrideValue])

  const invalid = (!formik || formik.submitCount > 0) && meta.touched && meta.error

  useEffect(debounce(() => {
    if (!noForm && !isNaN(debounceTime) && debounceTime > 0) {
      formik.validateForm()
    }
  }, debounceTime), [noForm, formik, field.value])

  const remaining = maxLength && maxLength - (field.value || '').length

  return (
    <>
      <InputGroup hasValidation className={inputGroupClassName}>
        {prepend}
        <BootstrapForm.Control
          ref={innerRef}
          {...field}
          {...props}
          onKeyDown={onKeyDownInner}
          onChange={onChangeInner}
          onBlur={onBlurInner}
          isInvalid={invalid}
          isValid={showValid && meta.initialValue !== meta.value && meta.touched && !meta.error}
        />
        {(clear && field.value) &&
          <Button
            variant={null}
            onClick={(e) => {
              helpers.setValue('')
              if (storageKey) {
                window.localStorage.removeItem(storageKey)
              }
              if (onChange) {
                onChange(formik, { target: { value: '' } })
              }
            }}
            className={`${styles.clearButton} ${styles.appendButton} ${invalid ? styles.isInvalid : ''}`}
          ><CloseIcon className='fill-grey' height={20} width={20} />
          </Button>}
        {append}
        <BootstrapForm.Control.Feedback type='invalid'>
          {meta.touched && meta.error}
        </BootstrapForm.Control.Feedback>
      </InputGroup>
      {hint && (
        <BootstrapForm.Text>
          {hint}
        </BootstrapForm.Text>
      )}
      {maxLength && !(meta.touched && meta.error && invalid) && (
        <BootstrapForm.Text className={remaining < 0 ? 'text-danger' : 'text-muted'}>
          {`${numWithUnits(remaining, { abbreviate: false, unitSingular: 'character', unitPlural: 'characters' })} remaining`}
        </BootstrapForm.Text>
      )}
    </>
  )
}

const INITIAL_SUGGESTIONS = { array: [], index: 0 }
export function UserSuggest ({
  query, onSelect, dropdownStyle, children,
  transformUser = user => user, selectWithTab = true, filterUsers = () => true
}) {
  const [getUsers] = useLazyQuery(TOP_USERS, {
    onCompleted: data => {
      setSuggestions({
        array: data.topUsers.users
          .filter((...args) => filterUsers(query, ...args))
          .map(transformUser),
        index: 0
      })
    }
  })
  const [getSuggestions] = useLazyQuery(USER_SEARCH, {
    onCompleted: data => {
      setSuggestions({
        array: data.searchUsers
          .filter((...args) => filterUsers(query, ...args))
          .map(transformUser),
        index: 0
      })
    }
  })

  const [suggestions, setSuggestions] = useState(INITIAL_SUGGESTIONS)
  const resetSuggestions = useCallback(() => setSuggestions(INITIAL_SUGGESTIONS), [])

  useEffect(() => {
    if (query !== undefined) {
      // remove both the leading @ and any @domain after nym
      const q = query?.replace(/^[@ ]+|[ ]+$/g, '').replace(/@[^\s]*$/, '')
      if (q === '') {
        getUsers({ variables: { by: 'stacked', when: 'week', limit: 5 } })
      } else {
        getSuggestions({ variables: { q } })
      }
    } else {
      resetSuggestions()
    }
  }, [query])

  const onKeyDown = useCallback(e => {
    switch (e.code) {
      case 'ArrowUp':
        if (suggestions.array.length === 0) {
          break
        }
        e.preventDefault()
        setSuggestions(suggestions =>
          ({
            ...suggestions,
            index: Math.max(suggestions.index - 1, 0)
          }))
        break
      case 'ArrowDown':
        if (suggestions.array.length === 0) {
          break
        }
        e.preventDefault()
        setSuggestions(suggestions =>
          ({
            ...suggestions,
            index: Math.min(suggestions.index + 1, suggestions.array.length - 1)
          }))
        break
      case 'Tab':
      case 'Enter':
        if (e.code === 'Tab' && !selectWithTab) {
          break
        }
        if (suggestions.array?.length === 0) {
          break
        }
        e.preventDefault()
        onSelect(suggestions.array[suggestions.index].name)
        resetSuggestions()
        break
      case 'Escape':
        e.preventDefault()
        resetSuggestions()
        break
      default:
        break
    }
  }, [onSelect, resetSuggestions, suggestions])
  return (
    <>
      {children?.({ onKeyDown, resetSuggestions })}
      <Dropdown show={suggestions.array.length > 0} style={dropdownStyle}>
        <Dropdown.Menu className={styles.suggestionsMenu}>
          {suggestions.array.map((v, i) =>
            <Dropdown.Item
              key={v.name}
              active={suggestions.index === i}
              onClick={() => {
                onSelect(v.name)
                resetSuggestions()
              }}
            >
              {v.name}
            </Dropdown.Item>)}
        </Dropdown.Menu>
      </Dropdown>
    </>
  )
}

export function InputUserSuggest ({
  label, groupClassName, transformUser, filterUsers,
  selectWithTab, onChange, transformQuery, ...props
}) {
  const [ovalue, setOValue] = useState()
  const [query, setQuery] = useState()
  return (
    <FormGroup label={label} className={groupClassName}>
      <UserSuggest
        transformUser={transformUser}
        filterUsers={filterUsers}
        selectWithTab={selectWithTab}
        onSelect={(v) => {
          // HACK ... ovalue does not trigger onChange
          onChange && onChange(undefined, { target: { value: v } })
          setOValue(v)
        }}
        query={query}
      >
        {({ onKeyDown, resetSuggestions }) => (
          <InputInner
            {...props}
            autoComplete='off'
            onChange={(formik, e) => {
              onChange && onChange(formik, e)
              setOValue(e.target.value)
              setQuery(e.target.value.replace(/^[@ ]+|[ ]+$/g, ''))
            }}
            overrideValue={ovalue}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(resetSuggestions, 100)}
          />
        )}
      </UserSuggest>
    </FormGroup>
  )
}

export function Input ({ label, groupClassName, ...props }) {
  return (
    <FormGroup label={label} className={groupClassName}>
      <InputInner {...props} />
    </FormGroup>
  )
}

export function VariableInput ({ label, groupClassName, name, hint, max, min, readOnlyLen, children, emptyItem = '', ...props }) {
  return (
    <FormGroup label={label} className={groupClassName}>
      <FieldArray name={name} hasValidation>
        {({ form, ...fieldArrayHelpers }) => {
          const options = form.values[name]
          return (
            <>
              {options?.map((_, i) => (
                <div key={i}>
                  <Row className='mb-2'>
                    <Col>
                      {children
                        ? children({ index: i, readOnly: i < readOnlyLen, placeholder: i >= min ? 'optional' : undefined })
                        : <InputInner name={`${name}[${i}]`} {...props} readOnly={i < readOnlyLen} placeholder={i >= min ? 'optional' : undefined} />}
                    </Col>
                    <Col className='d-flex ps-0' xs='auto'>
                      {options.length - 1 === i && options.length !== max
                        ? <AddIcon className='fill-grey align-self-center justify-self-center pointer' onClick={() => fieldArrayHelpers.push(emptyItem)} />
                        // filler div for col alignment across rows
                        : <div style={{ width: '24px', height: '24px' }} />}
                    </Col>
                    {options.length - 1 === i &&
                      <>
                        {hint && <BootstrapForm.Text>{hint}</BootstrapForm.Text>}
                        {form.touched[name] && typeof form.errors[name] === 'string' &&
                          <div className='invalid-feedback d-block'>{form.errors[name]}</div>}
                      </>}
                  </Row>
                </div>
              ))}
            </>
          )
        }}
      </FieldArray>
    </FormGroup>
  )
}

export function Checkbox ({ children, label, groupClassName, hiddenLabel, extra, handleChange, inline, disabled, ...props }) {
  // React treats radios and checkbox inputs differently other input types, select, and textarea.
  // Formik does this too! When you specify `type` to useField(), it will
  // return the correct bag of props for you
  const [field,, helpers] = useField({ ...props, type: 'checkbox' })
  return (
    <FormGroup className={groupClassName}>
      {hiddenLabel && <BootstrapForm.Label className='invisible'>{label}</BootstrapForm.Label>}
      <BootstrapForm.Check
        id={props.id || props.name}
        inline={inline}
      >
        <BootstrapForm.Check.Input
          {...field} {...props} disabled={disabled} type='checkbox' onChange={(e) => {
            field.onChange(e)
            handleChange && handleChange(e.target.checked, helpers.setValue)
          }}
        />
        <BootstrapForm.Check.Label className={'d-inline-flex flex-nowrap align-items-center' + (disabled ? ' text-muted' : '')}>
          <div className='flex-grow-1'>{label}</div>
          {extra &&
            <div className={styles.checkboxExtra}>
              {extra}
            </div>}
        </BootstrapForm.Check.Label>
      </BootstrapForm.Check>
    </FormGroup>
  )
}

const StorageKeyPrefixContext = createContext()

export function Form ({
  initial, schema, onSubmit, children, initialError, validateImmediately,
  storageKeyPrefix, validateOnChange = true, invoiceable, innerRef, ...props
}) {
  const toaster = useToast()
  const initialErrorToasted = useRef(false)
  const feeButton = useFeeButton()
  useEffect(() => {
    if (initialError && !initialErrorToasted.current) {
      toaster.danger(initialError.message || initialError.toString?.())
      initialErrorToasted.current = true
    }
  }, [])

  const clearLocalStorage = useCallback((values) => {
    Object.keys(values).forEach(v => {
      window.localStorage.removeItem(storageKeyPrefix + '-' + v)
      if (Array.isArray(values[v])) {
        values[v].forEach(
          (iv, i) => {
            Object.keys(iv).forEach(k => {
              window.localStorage.removeItem(`${storageKeyPrefix}-${v}[${i}].${k}`)
            })
            window.localStorage.removeItem(`${storageKeyPrefix}-${v}[${i}]`)
          })
      }
    })
  }, [storageKeyPrefix])

  // if `invoiceable` is set,
  // support for payment per invoice if they are lurking or don't have enough balance
  // is added to submit handlers.
  // submit handlers need to accept { satsReceived, hash, hmac } in their first argument
  // and use them as variables in their GraphQL mutation
  if (invoiceable && onSubmit) {
    const options = typeof invoiceable === 'object' ? invoiceable : undefined
    onSubmit = useInvoiceable(onSubmit, { callback: clearLocalStorage, ...options })
  }

  const onSubmitInner = useCallback(async (values, ...args) => {
    try {
      if (onSubmit) {
        // extract cost from formik fields
        // (cost may also be set in a formik field named 'amount')
        const cost = feeButton?.total || values?.amount
        if (cost) {
          values.cost = cost
        }

        const options = await onSubmit(values, ...args)
        if (!storageKeyPrefix || options?.keepLocalStorage) return
        clearLocalStorage(values)
      }
    } catch (err) {
      console.log(err)
      toaster.danger(err.message || err.toString?.())
    }
  }, [onSubmit, toaster, clearLocalStorage, storageKeyPrefix])

  return (
    <Formik
      initialValues={initial}
      validateOnChange={validateOnChange}
      validationSchema={schema}
      initialTouched={validateImmediately && initial}
      validateOnBlur={false}
      onSubmit={onSubmitInner}
      innerRef={innerRef}
    >
      <FormikForm {...props} noValidate>
        <StorageKeyPrefixContext.Provider value={storageKeyPrefix}>
          {children}
        </StorageKeyPrefixContext.Provider>
      </FormikForm>
    </Formik>
  )
}

export function Select ({ label, items, groupClassName, onChange, noForm, overrideValue, ...props }) {
  const [field, meta, helpers] = noForm ? [{}, {}, {}] : useField(props)
  const formik = noForm ? null : useFormikContext()
  const invalid = meta.touched && meta.error

  useEffect(() => {
    if (overrideValue) {
      helpers.setValue(overrideValue)
    }
  }, [overrideValue])

  return (
    <FormGroup label={label} className={groupClassName}>
      <BootstrapForm.Select
        {...field} {...props}
        onChange={(e) => {
          if (field?.onChange) {
            field.onChange(e)
          }

          if (onChange) {
            onChange(formik, e)
          }
        }}
        isInvalid={invalid}
      >
        {items?.map(item => <option key={item}>{item}</option>)}
      </BootstrapForm.Select>
      <BootstrapForm.Control.Feedback type='invalid'>
        {meta.touched && meta.error}
      </BootstrapForm.Control.Feedback>
    </FormGroup>
  )
}

export function DatePicker ({ fromName, toName, noForm, onChange, when, from, to, className, ...props }) {
  const formik = noForm ? null : useFormikContext()
  const [,, fromHelpers] = noForm ? [{}, {}, {}] : useField({ ...props, name: fromName })
  const [,, toHelpers] = noForm ? [{}, {}, {}] : useField({ ...props, name: toName })
  const { minDate, maxDate } = props

  const [{ innerFrom, innerTo }, setRange] = useState({
    innerFrom: from || whenToFrom(when),
    innerTo: to || dayMonthYear(new Date())
  })

  useEffect(() => {
    const tfrom = from || whenToFrom(when)
    const tto = to || dayMonthYear(new Date())
    setRange({ innerFrom: tfrom, innerTo: tto })
    if (!noForm) {
      fromHelpers.setValue(tfrom)
      toHelpers.setValue(tto)
    }
  }, [when, from, to])

  const dateFormat = useMemo(() => {
    const now = new Date(2013, 11, 31)
    let str = now.toLocaleDateString()
    str = str.replace('31', 'dd')
    str = str.replace('12', 'MM')
    str = str.replace('2013', 'yy')
    return str
  }, [])

  const innerOnChange = ([from, to], e) => {
    from = dayMonthYear(from)
    to = to ? dayMonthYear(to) : undefined
    setRange({ innerFrom: from, innerTo: to })
    if (!noForm) {
      fromHelpers.setValue(from)
      toHelpers.setValue(to)
    }
    onChange(formik, [from, to], e)
  }

  const onChangeRawHandler = (e) => {
    // raw user data can be incomplete while typing, so quietly bail on exceptions
    try {
      const dateStrings = e.target.value.split('-', 2)
      const dates = dateStrings.map(s => new Date(s))
      let [from, to] = dates
      if (from) {
        if (minDate) from = new Date(Math.max(from, minDate))
        try {
          if (maxDate) to = new Date(Math.min(to, maxDate))

          // if end date isn't valid, set it to the start date
          if (!(to instanceof Date && !isNaN(to)) || to < from) to = from
        } catch {
          to = from
        }
        innerOnChange([from, to], e)
      }
    } catch { }
  }

  return (
    <ReactDatePicker
      className={`form-control text-center ${className}`}
      selectsRange
      maxDate={new Date()}
      minDate={new Date('2021-05-01')}
      {...props}
      selected={dayMonthYearToDate(innerFrom)}
      startDate={dayMonthYearToDate(innerFrom)}
      endDate={innerTo ? dayMonthYearToDate(innerTo) : undefined}
      dateFormat={dateFormat}
      onChangeRaw={onChangeRawHandler}
      onChange={innerOnChange}
    />
  )
}
